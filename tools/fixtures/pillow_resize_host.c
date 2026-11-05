/* Diagnostic host adapter for unmodified Pillow 12.3.0 Resample.c.
 * RGB only. Owns storage/errors/GIL hooks, never reimplements filtering.
 * Native proof only: upstream headers use development headers or a type-only shim.
 */
#include "Imaging.h"
#include <math.h>
#include <stdlib.h>
#include <string.h>

void *ImagingError_MemoryError(void) { return NULL; }
void *ImagingError_ModeError(void) { return NULL; }
void *ImagingError_ValueError(const char *message) { (void)message; return NULL; }
void ImagingSectionEnter(ImagingSectionCookie *cookie) { *cookie = NULL; }
void ImagingSectionLeave(ImagingSectionCookie *cookie) { (void)cookie; }
int isModeI16(const ModeID mode) {
 return mode==IMAGING_MODE_I_16 || mode==IMAGING_MODE_I_16L || mode==IMAGING_MODE_I_16B || mode==IMAGING_MODE_I_16N;
}
void ImagingDelete(Imaging image) {
 if (!image) return;
 free(image->block); free(image->image); free(image);
}
Imaging ImagingNewDirty(ModeID mode, int width, int height) {
 if(mode!=IMAGING_MODE_RGB || width<1 || height<1 || width>16384 || height>16384
  ||(size_t)width*height>24000000) return NULL;
 Imaging image=calloc(1,sizeof(*image)); if(!image) return NULL;
 image->mode=mode; image->type=IMAGING_TYPE_UINT8; image->bands=3;
 image->xsize=width; image->ysize=height; image->pixelsize=4; image->linesize=width*4;
 image->image=calloc((size_t)height,sizeof(*image->image));
 image->block=calloc((size_t)height,(size_t)image->linesize);
 if(!image->image || !image->block) { ImagingDelete(image); return NULL; }
 for(int y=0;y<height;y++) image->image[y]=image->block+(size_t)y*image->linesize;
 image->image32=(INT32 **)image->image;
 return image;
}
Imaging ImagingCopy(Imaging source) {
 Imaging dest=ImagingNewDirty(source->mode,source->xsize,source->ysize);
 if(dest) memcpy(dest->block,source->block,(size_t)source->ysize*source->linesize);
 return dest;
}
static int pillow_resize_with_filter(const unsigned char *source,int width,int height,
 int out_width,int out_height,const float edges[4],unsigned char *destination,int filter,int source_limit,int output_limit,int preserve_tall_order) {
 if(!source || !destination || !edges || width<1 || height<1 || width>source_limit || height>source_limit
  ||(size_t)width*height>24000000
  ||out_width<1 || out_height<1 || out_width>output_limit || out_height>output_limit) return -1;
 for(int i=0;i<4;i++) if(!isfinite(edges[i])) return -1;
 if(edges[0]<0 || edges[1]<0 || edges[2]>width || edges[3]>height
  ||edges[2]<=edges[0] || edges[3]<=edges[1]) return -1;
 Imaging input=ImagingNewDirty(IMAGING_MODE_RGB,width,height); if(!input) return -2;
 for(int y=0;y<height;y++) for(int x=0;x<width;x++)
  memcpy(input->image[y]+x*4,source+((size_t)y*width+x)*3,3);
 float box[4];memcpy(box,edges,sizeof(box));
 /* Image.resize processes very tall downscales vertically first. Preserve that
  * RGB rounding order for crop and bilinear model preprocessing. */
 Imaging result=NULL;
 if(preserve_tall_order && height>width*100 && out_height<height) {
  float first_box[4]={0,box[1],(float)width,box[3]};
  Imaging vertical=ImagingResample(input,width,out_height,filter,first_box);
  if(vertical) {
   float second_box[4]={box[0],0,box[2],(float)out_height};
   result=ImagingResample(vertical,out_width,out_height,filter,second_box);
   ImagingDelete(vertical);
  }
 } else result=ImagingResample(input,out_width,out_height,filter,box);
 if(!result) { ImagingDelete(input); return -2; }
 for(int y=0;y<out_height;y++) for(int x=0;x<out_width;x++)
  memcpy(destination+((size_t)y*out_width+x)*3,result->image[y]+x*4,3);
 ImagingDelete(result); ImagingDelete(input); return 0;
}

int pillow_resize_rgb(const unsigned char *source,int width,int height,
 int out_width,int out_height,const float edges[4],unsigned char *destination) {
 return pillow_resize_with_filter(source,width,height,out_width,out_height,edges,destination,IMAGING_TRANSFORM_LANCZOS,2048,2048,0);
}
int pillow_resize_bilinear_rgb(const unsigned char *source,int width,int height,
 int out_width,int out_height,const float edges[4],unsigned char *destination) {
 #ifdef PILLOW_MODEL_TALL_ORDER
 return pillow_resize_with_filter(source,width,height,out_width,out_height,edges,destination,IMAGING_TRANSFORM_BILINEAR,2048,2048,1);
#else
 return pillow_resize_with_filter(source,width,height,out_width,out_height,edges,destination,IMAGING_TRANSFORM_BILINEAR,2048,2048,0);
#endif
}

/* Explicit original-size fractional crop; legacy model resize bounds stay unchanged. */
int pillow_crop_rgb(const unsigned char *source,int width,int height,
 int out_width,int out_height,const float edges[4],unsigned char *destination) {
 return pillow_resize_with_filter(source,width,height,out_width,out_height,edges,destination,IMAGING_TRANSFORM_LANCZOS,16384,4096,1);
}

#ifdef PILLOW_THUMBNAIL
/* Image.thumbnail/resize plumbing for loaded RGB, reducing_gap=2.0.
 * The actual averaging and Lanczos kernels remain unmodified upstream code.
 * Caller supplies the aspect-preserving final size from Image.thumbnail's rule.
 */
int pillow_thumbnail_rgb(const unsigned char *source,int width,int height,
 int out_width,int out_height,const float edges[4],unsigned char *destination) {
 if(!source||!destination||!edges||width<1||height<1||width>16384||height>16384
  ||(size_t)width*height>24000000||out_width<1||out_height<1||out_width>2000||out_height>2000
  ||out_width>width||out_height>height||edges[0]!=0||edges[1]!=0||edges[2]!=width||edges[3]!=height)return -1;
 Imaging input=ImagingNewDirty(IMAGING_MODE_RGB,width,height);if(!input)return -2;
 for(int y=0;y<height;y++)for(int x=0;x<width;x++)
  memcpy(input->image[y]+x*4,source+((size_t)y*width+x)*3,3);
 int factor_x=(int)((double)width/out_width/2.0),factor_y=(int)((double)height/out_height/2.0);
 if(factor_x<1)factor_x=1;if(factor_y<1)factor_y=1;
 float box[4]={0,0,(float)width,(float)height};
 if(factor_x>1||factor_y>1){
  int reduce_box[4]={0,0,width,height};
  Imaging reduced=ImagingReduce(input,factor_x,factor_y,reduce_box);
  ImagingDelete(input);input=reduced;if(!input)return -2;
  box[2]=(float)((double)width/factor_x);box[3]=(float)((double)height/factor_y);
 }
 Imaging result=NULL;
 /* Preserve Pillow's vertical-first path for very tall source planes. */
 if(input->ysize>input->xsize*100 && out_height<input->ysize){
  float first_box[4]={0,box[1],(float)input->xsize,box[3]};
  Imaging vertical=ImagingResample(input,input->xsize,out_height,IMAGING_TRANSFORM_LANCZOS,first_box);
  if(vertical){float second_box[4]={box[0],0,box[2],(float)out_height};
   result=ImagingResample(vertical,out_width,out_height,IMAGING_TRANSFORM_LANCZOS,second_box);ImagingDelete(vertical);}
 }else result=ImagingResample(input,out_width,out_height,IMAGING_TRANSFORM_LANCZOS,box);
 ImagingDelete(input);if(!result)return -2;
 for(int y=0;y<out_height;y++)for(int x=0;x<out_width;x++)
  memcpy(destination+((size_t)y*out_width+x)*3,result->image[y]+x*4,3);
 ImagingDelete(result);return 0;
}
#endif

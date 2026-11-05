/* Diagnostic C translation of PyMatting 1.1.16 estimate_foreground_ml.py (MIT).
 * License/copyright: licenses/PyMatting-MIT.txt.
 * Source SHA256 fd78cfb439940debc54c89a00638f025c0daef0bacc07fba393572787e9431ca.
 * Existing multilevel/in-place algorithm; scalar types follow captured Numba 0.68.
 * Native numerical proof only, not production adoption or CPU inference fallback.
 */
#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
static int clampi(int x,int n){return x<0?0:x>=n?n-1:x;}
static int round_even(double x){double low=floor(x),d=x-low;return (int)low+(d>0.5||(d==0.5&&((int)low&1)));}
static float *plane(size_t n){return (float*)calloc(n,sizeof(float));}
int pymatting_ml_rgb(const float *input,const float *alpha,int w0,int h0,float *output_f,float *output_b){
 if(!input||!alpha||!output_f||!output_b||w0<1||h0<1||w0>2000||h0>2000)return -1;
 if(w0==1&&h0==1)return -2; /* Captured reference raises ZeroDivisionError. */
 const size_t original=(size_t)w0*h0;const float regularization=(float)1e-5,gradient_weight=1.0f;
 float fm[3]={0},bm[3]={0};int nf=0,nb=0;
 for(size_t i=0;i<original;i++){
  if(!isfinite(alpha[i])||alpha[i]<0||alpha[i]>1)return -1;
  for(int c=0;c<3;c++)if(!isfinite(input[i*3+c])||input[i*3+c]<0||input[i*3+c]>1)return -1;
  if(alpha[i]>0.9){for(int c=0;c<3;c++)fm[c]+=input[i*3+c];nf++;}
  if(alpha[i]<0.1){for(int c=0;c<3;c++)bm[c]+=input[i*3+c];nb++;}
 }
 for(int c=0;c<3;c++){fm[c]=(float)((double)fm[c]/(nf+1e-5));bm[c]=(float)((double)bm[c]/(nb+1e-5));}
 float *fp=plane(3),*bp=plane(3),*image=NULL,*a=NULL,*f=NULL,*b=NULL;int wp=1,hp=1,result=-3;
 if(!fp||!bp)goto done;memcpy(fp,fm,sizeof(fm));memcpy(bp,bm,sizeof(bm));
 const int levels=(int)ceil(log2((double)(w0>h0?w0:h0)));
 for(int level=0;level<=levels;level++){
  const int w=round_even(pow((double)w0,(double)level/levels)),h=round_even(pow((double)h0,(double)level/levels));const size_t n=(size_t)w*h;
  image=plane(n*3);a=plane(n);f=plane(n*3);b=plane(n*3);if(!image||!a||!f||!b)goto done;
  for(int y=0;y<h;y++)for(int x=0;x<w;x++){
   const size_t i=(size_t)y*w+x,src=(size_t)(y*h0/h)*w0+x*w0/w,prev=(size_t)(y*hp/h)*wp+x*wp/w;
   a[i]=alpha[src];for(int c=0;c<3;c++){image[i*3+c]=input[src*3+c];f[i*3+c]=fp[prev*3+c];b[i*3+c]=bp[prev*3+c];}
  }
  const int iterations=w<=32&&h<=32?10:2;const int dx[4]={-1,1,0,0},dy[4]={0,0,-1,1};
  for(int iteration=0;iteration<iterations;iteration++)for(int y=0;y<h;y++)for(int x=0;x<w;x++){
   const size_t i=(size_t)y*w+x;const float a0=a[i];const double a1=1.0-(double)a0;
   float a00=a0*a0;const double a01=(double)a0*a1;double a11=a1*a1;float rhs[2][3];
   for(int c=0;c<3;c++){rhs[0][c]=a0*image[i*3+c];rhs[1][c]=(float)(a1*(double)image[i*3+c]);}
   for(int d=0;d<4;d++){
    const int x2=clampi(x+dx[d],w),y2=clampi(y+dy[d],h);const size_t j=(size_t)y2*w+x2;
    const float gradient=fabsf(a0-a[j]);const float da=regularization+gradient_weight*gradient;
    a00+=da;a11+=(double)da;
    for(int c=0;c<3;c++){rhs[0][c]+=da*f[j*3+c];rhs[1][c]+=da*b[j*3+c];}
   }
   const double determinant=(double)a00*a11-a01*a01,inv_det=1.0/determinant;
   const double b00=inv_det*a11,b01=inv_det*(-a01),b11=inv_det*(double)a00;
   for(int c=0;c<3;c++){
    double fc=b00*(double)rhs[0][c]+b01*(double)rhs[1][c],bc=b01*(double)rhs[0][c]+b11*(double)rhs[1][c];
    if(!isfinite(fc)||!isfinite(bc)){result=-4;goto done;}
    fc=fmax(0.0,fmin(1.0,fc));bc=fmax(0.0,fmin(1.0,bc));f[i*3+c]=(float)fc;b[i*3+c]=(float)bc;
   }
  }
  free(image);image=NULL;free(a);a=NULL;free(fp);free(bp);fp=f;bp=b;f=NULL;b=NULL;wp=w;hp=h;
 }
 memcpy(output_f,fp,original*3*sizeof(float));memcpy(output_b,bp,original*3*sizeof(float));result=0;
done:
 free(fp);free(bp);free(image);free(a);free(f);free(b);return result;
}

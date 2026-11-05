// Auxiliary native OpenCV probe; not the pinned 4.11 runtime reference.
#include <opencv2/core.hpp>
#include <opencv2/imgproc.hpp>
#include <algorithm>
#include <cfenv>
#include <cmath>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>
static void write(const std::string& path,const cv::Mat& mat){std::ofstream out(path,std::ios::binary);if(!out)throw std::runtime_error("write-failed");for(int y=0;y<mat.rows;y++)out.write(reinterpret_cast<const char*>(mat.ptr(y)),mat.cols);}
int main(int argc,char** argv){
 if(argc!=2)return 2;cv::setNumThreads(1);std::fesetround(FE_TONEAREST);
 const std::string root=argv[1];struct Case{int w,h,pattern;};
 const std::vector<Case> cases={{1,1,0},{1,7,1},{7,1,1},{17,13,2},{32,31,3},{584,1,4},{750,1,4},{1250,1,4}};
 std::cout<<"{\"status\":\"auxiliary-native-captured\",\"opencv\":\""<<CV_VERSION<<"\",\"cases\":[";
 for(size_t index=0;index<cases.size();index++){
  const auto c=cases[index];cv::Mat mask(c.h,c.w,CV_8UC1);const unsigned char values[]={0,5,6,127,249,250,255};
  for(int y=0;y<c.h;y++)for(int x=0;x<c.w;x++){
   unsigned char value=255;
   if(c.pattern==1)value=values[(x+y)%7];
   if(c.pattern==2)value=(x>=5&&x<13&&y>=4&&y<10)?255:0;
   if(c.pattern==3)value=x<10?0:x<22?128:255;
   if(c.pattern==4)value=x<c.w/3?5:x<2*c.w/3?128:250;
   mask.at<unsigned char>(y,x)=value;
  }
  const int radius=std::max(3,static_cast<int>(std::nearbyint(std::max(c.w,c.h)*0.006)));
  auto kernel=cv::getStructuringElement(cv::MORPH_ELLIPSE,cv::Size(2*radius+1,2*radius+1));
  cv::Mat fg=(mask>=250),bg=(mask<=5);fg/=255;bg/=255;
  cv::erode(fg,fg,kernel);cv::erode(bg,bg,kernel);
  cv::Mat jsfg,jsbg;cv::threshold(mask,jsfg,249,255,cv::THRESH_BINARY);cv::threshold(mask,jsbg,5,255,cv::THRESH_BINARY_INV);cv::erode(jsfg,jsfg,kernel);cv::erode(jsbg,jsbg,kernel);
  cv::Mat trimap(c.h,c.w,CV_8UC1,cv::Scalar(128));int foreground=0,background=0,unknown=0;
  for(int y=0;y<c.h;y++)for(int x=0;x<c.w;x++){
   if((fg.at<unsigned char>(y,x)!=0)!=(jsfg.at<unsigned char>(y,x)!=0)||(bg.at<unsigned char>(y,x)!=0)!=(jsbg.at<unsigned char>(y,x)!=0))throw std::runtime_error("threshold-path-mismatch");
   auto& value=trimap.at<unsigned char>(y,x);if(fg.at<unsigned char>(y,x))value=255;if(bg.at<unsigned char>(y,x))value=0;
   foreground+=value==255;background+=value==0;unknown+=value==128;
  }
  const std::string stem="case-"+std::to_string(index);write(root+"/"+stem+"-alpha.bin",mask);write(root+"/"+stem+"-trimap.bin",trimap);write(root+"/"+stem+"-kernel.bin",kernel);
  if(index)std::cout<<",";
  std::cout<<"{\"stem\":\""<<stem<<"\",\"width\":"<<c.w<<",\"height\":"<<c.h<<",\"radius\":"<<radius<<",\"foreground\":"<<foreground<<",\"background\":"<<background<<",\"unknown\":"<<unknown<<",\"thresholdPathsEqual\":true}";
 }
 std::cout<<"]}\n";
}

import {useTranslation} from 'react-i18next';
import {t} from './i18n';
import {useId} from 'react';
import {paperLayout} from '../../tools/browser-library-adapter/print-geometry.mjs';
import type {CropArea} from './export/types';
type Picture={url:string;width:number;height:number;crop:CropArea};
export function PaperPreview({layout,picture,pngUrl}:{layout:ReturnType<typeof paperLayout>;picture?:Picture;pngUrl?:string}){
 useTranslation();
 const tileId=useId(),[left,top]=layout.positions[0];
 const pitchX=layout.photoWidth+layout.gap,pitchY=layout.photoHeight+layout.gap;
 // A single SVG pattern reuses the local photo, including when tiny inputs produce many copies.
 return <figure className="paper-preview" aria-label={t("用紙のプレビュー")}>{pngUrl?<img className="sheet" src={pngUrl} alt={t("作成済みの用紙PNG")}/>:
  <svg className="sheet" viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label={t(t("用紙に{{v0}}枚を配置する目安",{v0:layout.count}))}>
   <defs><pattern id={tileId} x={left} y={top} width={pitchX} height={pitchY} patternUnits="userSpaceOnUse" viewBox={`0 0 ${pitchX} ${pitchY}`}>
    {picture?<svg width={layout.photoWidth} height={layout.photoHeight} viewBox={`${picture.crop.x} ${picture.crop.y} ${picture.crop.width} ${picture.crop.height}`} preserveAspectRatio="none" overflow="hidden"><image href={picture.url} width={picture.width} height={picture.height} preserveAspectRatio="none"/></svg>:<rect width={layout.photoWidth} height={layout.photoHeight} fill="#dce3e0"/>}
    <rect width={layout.photoWidth} height={layout.photoHeight} fill="none" stroke="#6d7b74" strokeWidth="1"/>
   </pattern></defs>
   <rect width={layout.width} height={layout.height} fill="white"/>
   <rect x={left} y={top} width={layout.columns*layout.photoWidth+(layout.columns-1)*layout.gap} height={layout.rows*layout.photoHeight+(layout.rows-1)*layout.gap} fill={`url(#${tileId})`}/>
  </svg>}
  <figcaption className="hint">{t(pngUrl?t("作成済みのPNGです。"):t("配置の目安です。"))}{t("画面上の大きさは印刷実寸ではありません。")}</figcaption>
 </figure>;
}

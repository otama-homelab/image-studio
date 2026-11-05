import {useId,useState} from 'react';

/** Display only: reuse the two existing URLs without canvas, inference or encoding. */
export function BackgroundComparison({original,result,width,height,originalAlt='背景編集前の写真',resultAlt='背景編集後の写真',loading='eager'}:{original:string;result:string;width:number;height:number;originalAlt?:string;resultAlt?:string;loading?:'lazy'|'eager'}){
 const [position,setPosition]=useState(50),[zoom,setZoom]=useState('fit'),hint=useId();
 const imageWidth=zoom==='fit'?'100%':`${width*Number(zoom)}px`,fitWidth=zoom==='fit'?`${520*width/height}px`:'none';
 return <div className="background-comparison">
  <label>プレビューの倍率<select value={zoom} onChange={event=>setZoom(event.target.value)}><option value="fit">全体を表示</option><option value="1">100%（等倍）</option><option value="2">200%</option></select></label>
  <div className="background-comparison-viewport" tabIndex={zoom==='fit'?-1:0} role="region" aria-label="背景比較の表示領域">
  <div className="background-comparison-images" style={{aspectRatio:`${width} / ${height}`,width:imageWidth,maxWidth:fitWidth}}>
   <img src={original} alt={originalAlt} loading={loading}/>
   <div className="background-comparison-result" style={{clipPath:`inset(0 ${100-position}% 0 0)`}}><img src={result} alt={resultAlt} loading={loading}/></div>
   {position>0&&position<100&&<span className="background-comparison-divider" style={{left:`${position}%`}} aria-hidden="true"/>}
  </div>
  </div>
  <p id={hint}>左が仕上がり、右が元の写真です。比較しても再処理しません。スライダーは左右キーでも動かせます。</p>
  <p>倍率は画面表示だけに適用します。保存寸法は変わりません。拡大時は表示領域をスクロールして確認できます。</p>
  <label>仕上がりの表示範囲<input type="range" min="0" max="100" step="1" value={position} aria-describedby={hint} aria-valuetext={position===0?'元の写真のみ':position===100?'仕上がりのみ':`左${position}%が仕上がり、右${100-position}%が元の写真`} onChange={event=>setPosition(Number(event.target.value))}/></label>
  <div className="background-comparison-actions"><button onClick={()=>setPosition(0)}>元の写真のみ</button><button onClick={()=>setPosition(100)}>仕上がりのみ</button></div>
 </div>;
}

export type PaperKind='a4'|'l'|'2l'|'postcard';
export type OutputOptions={kind:'crop';format:'png'}|{kind:'paper';format:'png'|'pdf';paper:PaperKind};
export type CropArea={x:number;y:number;width:number;height:number};
export type CropRequest={mode:'crop';file:Blob;crop:CropArea;width:number;height:number;sourceWidth:number;sourceHeight:number;output:OutputOptions};
export type DirectPrintRequest={mode:'original';file:Blob;sourceWidth:number;sourceHeight:number;output:Extract<OutputOptions,{kind:'paper'}>};
export type ExportRequest=CropRequest|DirectPrintRequest;
export type PreparedFile={bytes:Uint8Array<ArrayBuffer>;width:number;height:number}&(
 {mime:'image/png';filename:'image-studio-crop-300dpi.png'|`image-studio-paper-${PaperKind}-300dpi.png`}|
 {mime:'application/pdf';filename:`image-studio-paper-${PaperKind}.pdf`});

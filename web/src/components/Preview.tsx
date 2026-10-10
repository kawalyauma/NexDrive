import {X,Download} from 'lucide-react';
import type {DriveNode} from '../api';
export default function Preview({workspaceId,item,onClose}:{
 workspaceId:string;item:DriveNode;onClose:()=>void;
}){
 const path='/api/workspaces/'+workspaceId+'/nodes/'+item.id;
 const mime=item.mime_type||'';
 const isImage=['image/jpeg','image/png','image/gif','image/webp'].includes(mime);
 const isPDF=mime==='application/pdf';
 return <div className="modal-backdrop preview-backdrop" role="presentation" onMouseDown={e=>{
  if(e.target===e.currentTarget)onClose();
 }}>
  <section className="preview-dialog" role="dialog" aria-modal="true" aria-label={'Preview '+item.name}>
   <header><strong title={item.name}>{item.name}</strong><div>
    <a href={path+'/download'} aria-label="Download file" title="Download"><Download size={18}/></a>
    <button aria-label="Close preview" title="Close" onClick={onClose}><X size={20}/></button></div></header>
   <div className="preview-body">{isImage?<img src={path+'/preview'} alt={item.name}/>:
     isPDF?<iframe title={item.name} src={path+'/preview'} sandbox="allow-downloads"/>:
     <div className="empty-files"><h3>Preview not supported yet</h3><p>Download this file to open it.</p></div>}
   </div>
  </section>
 </div>;
}

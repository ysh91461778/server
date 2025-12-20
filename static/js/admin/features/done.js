// “기록 완료” 전체 처리 버튼
import { $, toast } from '../core/utils.js';
import { state } from '../core/state.js';

export function initClearAll(){
  $('clearAllBtn')?.addEventListener('click', ()=>{
    for (const date in state.logs) for (const sid in state.logs[date]) {
      const entry = state.logs[date][sid];
      if (entry.done && !entry.archived) entry.archived = true;
    }
    fetch('/api/logs',{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(state.logs) })
      .then(()=>{ toast('모든 완료된 기록이 정리되었습니다'); document.dispatchEvent(new CustomEvent('admin:refresh')); });
  });
}

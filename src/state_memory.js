import fs from 'fs';
export const state = { save: (k,v)=>fs.writeFileSync('state.json',JSON.stringify({k,v})), load: ()=>{try{return JSON.parse(fs.readFileSync('state.json'))}catch{return null}} };
export const memory = { get:(k)=>state.load()?.memory?.[k], set:(k,v)=>{const s=state.load()||{};s.memory=s.memory||{};s.memory[k]=v;state.save('memory',s.memory);}, search:(q)=>Object.entries(memory.get('__all')||{}).filter(([k])=>k.includes(q)) };

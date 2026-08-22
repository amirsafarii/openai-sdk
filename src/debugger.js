import fs from 'fs';
export class Debugger {
  events = [];
  append(e){this.events.push({id:Math.random().toString(36).slice(2),...e,timestamp:Date.now()});}
  getAll(){return this.events;}
  getByRun(r){return this.events.filter(x=>x.runId===r);}
  getTimeline(r){return this.getByRun(r).sort((a,b)=>a.timestamp-b.timestamp);}
  persist(){fs.writeFileSync('debugger.json',JSON.stringify(this.events));}
  recover(){try{this.events=JSON.parse(fs.readFileSync('debugger.json','utf8'))}catch{}}
}

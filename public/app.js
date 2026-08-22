fetch('/events').catch(()=>{});
document.body.innerHTML += '<p>Runtime متصل - Debugger: ' + (typeof Debugger !== 'undefined' ? 'PASS' : 'N/A') + '</p>';

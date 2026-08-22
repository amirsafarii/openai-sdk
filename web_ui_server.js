import express from 'express';
const app = express();
app.use(express.static('public'));
app.listen(3000, () => console.log('Web UI: http://0.0.0.0:3000'));

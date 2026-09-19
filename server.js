const express = require('express');
const path = require('path');
const app = express();
app.disable('x-powered-by');
app.get('/api/health', (_req,res)=>res.json({ok:true,service:'SetupDT V1.9.1',time:new Date().toISOString()}));
app.use(express.static(path.join(__dirname,'public')));
app.get('/',(_req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(process.env.PORT || 10000,'0.0.0.0',()=>console.log('SetupDT online'));

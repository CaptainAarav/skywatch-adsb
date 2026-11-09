// Run in the page via CDP (Runtime.evaluate, awaitPromise). Asserts on the selected aircraft's sprite ImageData: transparent corners,
// mostly white body, thin dark outline, white low-alpha glow, and no pill for an empty label. Prints one JSON object. No images.
(async()=>{const w=ms=>new Promise(r=>setTimeout(r,ms));const o={};
const h=g.planesOrdered.find(p=>p.position&&p.altitude!=null&&p.shape);selectPlaneByHex(h.icao,{follow:false});await w(2500);
const e=MLR.planes.get(h.icao);o.sel=e&&e.sel;o.key=e&&e.icon;
const d=MLR.iconData.get(e.icon);o.have=!!d;
if(d){const im=d.data,W=im.width,H=im.height,px=(x,y)=>{const i=(y*W+x)*4;return [im.data[i],im.data[i+1],im.data[i+2],im.data[i+3]]};
o.size=[W,H];o.corners=[px(0,0),px(W-1,0),px(0,H-1),px(W-1,H-1)].map(c=>c[3]);
let opq=0,white=0,dark=0;for(let i=0;i<im.data.length;i+=4){const a=im.data[i+3];if(a>200){opq++;const l=(im.data[i]+im.data[i+1]+im.data[i+2])/3;if(l>=235)white++;else if(l<40)dark++}}
o.opaque=opq;o.whiteFrac=+(white/opq).toFixed(3);o.darkFrac=+(dark/opq).toFixed(3);
let tr=0;for(let i=3;i<im.data.length;i+=4)if(im.data[i]<8)tr++;o.transparentFrac=+(tr/(W*H)).toFixed(3)}
const m=MLR.map;o.glow={color:m.getPaintProperty('tar-plane-glow','circle-color'),stroke:m.getPaintProperty('tar-plane-glow','circle-stroke-color'),filter:JSON.stringify(m.getFilter('tar-plane-glow'))};
o.labelFilter=JSON.stringify(m.getFilter('tar-plane-labels'));
const feats=m.getSource('tar-planes')._data.features||[];const selF=feats.filter(f=>f.properties.sel===1);o.selFeatures=selF.length;o.selLabel=selF[0]&&selF[0].properties.label;
o.maxIconBrightnessOthers=null;
document.getElementById('settings_infoblock');
return JSON.stringify(o)})()

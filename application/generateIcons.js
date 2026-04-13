const fs = require('fs');
const sharp = require('sharp');

const svgCode = `
<svg width="1024" height="1024" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
  <rect width="120" height="120" rx="26" fill="#1C1208"/>
  <rect width="120" height="120" rx="26" fill="#2a1a08" opacity="0.5"/>
  <polygon points="60,22 32,82 60,68" fill="#C1440E"/>
  <polygon points="60,22 88,82 60,68" fill="#7A2A06"/>
  <polygon points="32,82 60,68 88,82 60,90" fill="#4a1a04"/>
</svg>
`;

(async () => {
  try {
    if(!fs.existsSync('./assets')) { fs.mkdirSync('./assets'); }
    await sharp(Buffer.from(svgCode))
      .png()
      .toFile('./assets/icon.png');
    
    await sharp(Buffer.from(svgCode))
      .png()
      .toFile('./assets/splash.png');
      
    await sharp(Buffer.from(svgCode))
      .png()
      .toFile('./assets/adaptive-icon.png');

    console.log('Images generated successfully!');
  } catch(e) {
    console.error(e);
  }
})();

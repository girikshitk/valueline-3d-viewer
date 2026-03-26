const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const MODEL_DIR = path.join(__dirname, 'Model Photos');
const GALLERY_DIR = path.join(__dirname, 'Gallery photos');
const OUTPUT_MODEL_DIR = path.join(__dirname, 'models');
const OUTPUT_GALLERY_DIR = path.join(__dirname, 'gallery');

const SKIN_NORMALIZE = { 'Calcattaluxe': 'Calacattaluxe' };

async function convertModelPhotos() {
    if (!fs.existsSync(OUTPUT_MODEL_DIR)) fs.mkdirSync(OUTPUT_MODEL_DIR);
    const files = fs.readdirSync(MODEL_DIR).filter(f => /\.(png|jpg|jpeg)$/i.test(f));
    const rooms = new Set(), skins = new Set();
    const images = {};

    for (const file of files) {
        const name = path.parse(file).name;
        const parts = name.split('_');
        if (parts.length < 3) continue;

        const room = parts[0];
        const time = parts[parts.length - 1];
        const rawSkin = parts.slice(1, -1).join('_');
        const skin = SKIN_NORMALIZE[rawSkin] || rawSkin;

        rooms.add(room);
        skins.add(skin);

        const outName = `${room}_${skin}_${time}.webp`;
        const outPath = path.join(OUTPUT_MODEL_DIR, outName);
        const key = `${room}_${skin}_${time}`;

        console.log(`Converting: ${file} -> ${outName}`);
        await sharp(path.join(MODEL_DIR, file))
            .webp({ quality: 80 })
            .toFile(outPath);

        images[key] = `models/${outName}`;
    }

    return { rooms: [...rooms], skins: [...skins], images };
}

async function convertGalleryPhotos() {
    if (!fs.existsSync(OUTPUT_GALLERY_DIR)) fs.mkdirSync(OUTPUT_GALLERY_DIR, { recursive: true });
    const gallery = {};
    const skinDirs = fs.readdirSync(GALLERY_DIR).filter(d =>
        fs.statSync(path.join(GALLERY_DIR, d)).isDirectory()
    );

    for (const skinDir of skinDirs) {
        const dirPath = path.join(GALLERY_DIR, skinDir);
        const files = fs.readdirSync(dirPath).filter(f => /\.(png|jpg|jpeg)$/i.test(f));
        const outDir = path.join(OUTPUT_GALLERY_DIR, skinDir);
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

        gallery[skinDir] = [];
        for (const file of files) {
            const name = path.parse(file).name;
            const outName = `${name}.webp`;
            console.log(`Gallery: ${skinDir}/${file} -> ${outName}`);
            await sharp(path.join(dirPath, file))
                .webp({ quality: 85 })
                .resize(1920, null, { withoutEnlargement: true })
                .toFile(path.join(outDir, outName));
            gallery[skinDir].push(`gallery/${skinDir}/${outName}`);
        }
    }
    return gallery;
}

async function main() {
    console.log('=== VALUELINE Image Converter ===\n');
    const model = await convertModelPhotos();
    console.log('\nConverting gallery photos...');
    const gallery = await convertGalleryPhotos();

    const manifest = { ...model, gallery };
    fs.writeFileSync(path.join(__dirname, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log('\nDone! manifest.json created.');
    console.log(`Rooms: ${model.rooms.join(', ')}`);
    console.log(`Skins: ${model.skins.join(', ')}`);
    console.log(`Images: ${Object.keys(model.images).length}`);
}

main().catch(console.error);

import gallery from '@config/gallery.json';
import { filled } from './site';

/*
  Club photos. The images live in src/assets/gallery/ so Astro optimises them;
  the captions live in config/gallery.json so the club can edit them without
  touching code.

  The two are joined on filename. A photo with no caption still appears, and a
  caption whose file has been removed is dropped — neither breaks the page.
*/

export interface Photo {
  file: string;
  caption: string;
  alt: string;
  image: ImageMetadata;
  /**
   * How the photo is laid out, from its own proportions — so a 4:3 group shot
   * is not square-cropped just because it is not a panorama.
   */
  shape: 'pano' | 'landscape' | 'square';
}

const files = import.meta.glob<{ default: ImageMetadata }>(
  '../assets/gallery/*.{jpg,jpeg,png,webp,avif}',
  { eager: true },
);

const byName = new Map(
  Object.entries(files).map(([path, mod]) => [path.split('/').pop()!, mod.default]),
);

function shapeOf(image: ImageMetadata): Photo['shape'] {
  const ratio = image.width / image.height;
  if (ratio >= 1.6) return 'pano';
  if (ratio >= 1.15) return 'landscape';
  return 'square';
}

export const galleryTitle = filled(gallery.title) ?? 'Gallery';
export const galleryIntro = filled(gallery.intro);

export const photos: Photo[] = gallery.photos.flatMap((p) => {
  const image = byName.get(p.file);
  if (!image) return [];
  return [
    {
      file: p.file,
      caption: filled(p.caption) ?? '',
      // Alt text is required for a photo to mean anything to a screen reader.
      // Falling back to the caption beats falling back to nothing.
      alt: filled(p.alt) ?? filled(p.caption) ?? 'Dreamers Cricket Club',
      image,
      shape: shapeOf(image),
    },
  ];
});

/** Anything dropped into the folder but not yet captioned, appended at the end. */
export const uncaptioned: Photo[] = [...byName.entries()]
  .filter(([name]) => !gallery.photos.some((p) => p.file === name))
  .map(([name, image]) => ({
    file: name,
    caption: '',
    alt: 'Dreamers Cricket Club',
    image,
    shape: shapeOf(image),
  }));

export const allPhotos = [...photos, ...uncaptioned];

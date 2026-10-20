import sharp from "sharp";

export interface ProcessedImage {
  avifBuffer: Buffer;
  width: number;
  height: number;
  aspectRatio: number;
  originalSize: number;
  avifSize: number;
  format: string;
}

export interface ImageProcessingOptions {
  quality?: number;
  effort?: number;
  maxDimension?: number;
}

/**
 * Validates, measures, and transcodes an input image buffer into an optimized AVIF buffer.
 * Automatically computes exact aspect ratio for UI feed cards.
 */
export async function processImageToAvif(
  inputBuffer: Buffer,
  options: ImageProcessingOptions = {}
): Promise<ProcessedImage> {
  const { quality = 75, effort = 4, maxDimension = 3840 } = options;

  let pipeline = sharp(inputBuffer, { failOnError: false }).rotate(); // Auto-rotate via EXIF orientation

  const metadata = await pipeline.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("Unable to read image dimensions or format unsupported");
  }

  // Downscale if higher than maxDimension (e.g. 4K cap for mobile feed performance)
  if (metadata.width > maxDimension || metadata.height > maxDimension) {
    pipeline = pipeline.resize({
      width: metadata.width > metadata.height ? maxDimension : undefined,
      height: metadata.height >= metadata.width ? maxDimension : undefined,
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  // Convert to AVIF
  const avifBuffer = await pipeline
    .avif({
      quality,
      effort,
      chromaSubsampling: "4:2:0",
      lossless: false,
    })
    .toBuffer();

  // Get final dimensions
  const finalMeta = await sharp(avifBuffer).metadata();
  const width = finalMeta.width || metadata.width;
  const height = finalMeta.height || metadata.height;
  const aspectRatio = parseFloat((width / height).toFixed(4));

  return {
    avifBuffer,
    width,
    height,
    aspectRatio,
    originalSize: inputBuffer.length,
    avifSize: avifBuffer.length,
    format: "avif",
  };
}

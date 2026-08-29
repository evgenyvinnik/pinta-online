import type { EffectId, EffectParameters } from './types';
import {
  clampTruncatedByte,
  reportPixels,
  reportProgress,
  setProgressReporter,
  value,
  type EffectProgressReporter,
  processLocalHistogram,
  intensityByte,
} from './kernels/shared';
import {
  applyBrightnessContrast,
  levelChannel,
  posterizeLevels,
  processAutoLevel,
  processChromaticAberration,
  processColoredGrayscale,
  processCurves,
  processDirectionalDifference,
  processDithering,
  processGlow,
  processHueSaturation,
  processLevels,
  processNightVision,
  processRedEyeRemoval,
  processSoftenPortrait,
  processVignette,
} from './kernels/pixelOps';
import {
  processBulge,
  processDents,
  processFrostedGlass,
  processHexagonPixelate,
  processPixelate,
  processPixelDrag,
  processPolarInversion,
  processRowSlice,
  processTileReflection,
  processTwist,
} from './kernels/distortions';
import { gaussianBlur, processFragment, processMotionBlur, processRadialBlur, processZoomBlur } from './kernels/blur';
import { processCells, processClouds, processFractal, processNoise, processVoronoi } from './kernels/generators';
import {
  processAdjustmentNoise,
  processAlignObject,
  processColoredArtifacts,
  processFeatherObject,
  processInkSketch,
  processOilPainting,
  processOutlineObject,
  processPencilSketch,
  processScanlines,
} from './kernels/artistic';

export function processEffect(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  effect: EffectId,
  parameters: EffectParameters,
  onProgress?: EffectProgressReporter,
) {
  // setProgressReporter resets the range and the last-reported mark as well.
  setProgressReporter(onProgress);
  reportProgress(0, true);
  try {
    const output = new Uint8ClampedArray(source);
    if (effect === 'auto-level') {
      processAutoLevel(output);
    } else if (effect === 'black-white') {
      for (let index = 0; index < output.length; index += 4) {
        const gray = intensityByte(output[index], output[index + 1], output[index + 2]);
        output[index] = gray;
        output[index + 1] = gray;
        output[index + 2] = gray;
        reportPixels(index, output.length);
      }
    } else if (effect === 'brightness-contrast') {
      applyBrightnessContrast(output, value(parameters, 'brightness', 0), value(parameters, 'contrast', 0));
    } else if (effect === 'curves') {
      processCurves(output, parameters);
    } else if (effect === 'hue-saturation') {
      processHueSaturation(output, parameters);
    } else if (effect === 'invert') {
      for (let index = 0; index < output.length; index += 4) {
        output[index] = 255 - output[index];
        output[index + 1] = 255 - output[index + 1];
        output[index + 2] = 255 - output[index + 2];
        reportPixels(index, output.length);
      }
    } else if (effect === 'levels') {
      processLevels(output, parameters);
    } else if (effect === 'posterize') {
      const tables = [
        posterizeLevels(value(parameters, 'red', 16)),
        posterizeLevels(value(parameters, 'green', 16)),
        posterizeLevels(value(parameters, 'blue', 16)),
      ];
      for (let index = 0; index < output.length; index += 4) {
        output[index] = tables[0][output[index]];
        output[index + 1] = tables[1][output[index + 1]];
        output[index + 2] = tables[2][output[index + 2]];
        reportPixels(index, output.length);
      }
    } else if (effect === 'sepia') {
      // SepiaEffect desaturates, then runs a Level op whose per-channel gamma is
      // [B 1.2, G 1.0, R 0.8]; the tint comes from those curves, not a linear scale.
      const strength = value(parameters, 'strength', 100) / 100;
      for (let index = 0; index < output.length; index += 4) {
        const gray = intensityByte(output[index], output[index + 1], output[index + 2]);
        const toned = [levelChannel(gray, 0.8), levelChannel(gray, 1), levelChannel(gray, 1.2)];
        for (let channel = 0; channel < 3; channel += 1) {
          output[index + channel] = clampTruncatedByte(
            output[index + channel] + strength * (toned[channel] - output[index + channel]),
          );
        }
        reportPixels(index, output.length);
      }
    } else if (effect === 'fragment') {
      return processFragment(source, width, height, parameters);
    } else if (effect === 'gaussian-blur') {
      return gaussianBlur(source, width, height, value(parameters, 'radius', 2));
    } else if (effect === 'motion-blur') {
      return processMotionBlur(source, width, height, parameters);
    } else if (effect === 'radial-blur') {
      return processRadialBlur(source, width, height, parameters);
    } else if (effect === 'unfocus') {
      return processLocalHistogram(source, width, height, parameters, 'unfocus');
    } else if (effect === 'zoom-blur') {
      return processZoomBlur(source, width, height, parameters);
    } else if (effect === 'bulge') {
      return processBulge(source, width, height, parameters);
    } else if (effect === 'dents') {
      return processDents(source, width, height, parameters);
    } else if (effect === 'frosted-glass') {
      return processFrostedGlass(source, width, height, parameters);
    } else if (effect === 'pixelate') {
      return processPixelate(source, width, height, value(parameters, 'cellSize', 2));
    } else if (effect === 'polar-inversion') {
      return processPolarInversion(source, width, height, parameters);
    } else if (effect === 'tile-reflection') {
      return processTileReflection(source, width, height, parameters);
    } else if (effect === 'twist') {
      return processTwist(source, width, height, parameters);
    } else if (effect === 'add-noise') {
      processNoise(output, parameters);
    } else if (effect === 'median') {
      return processLocalHistogram(source, width, height, parameters, 'median');
    } else if (effect === 'reduce-noise') {
      return processLocalHistogram(source, width, height, parameters, 'reduce-noise');
    } else if (effect === 'ink-sketch') {
      return processInkSketch(source, width, height, parameters);
    } else if (effect === 'oil-painting') {
      return processOilPainting(source, width, height, parameters);
    } else if (effect === 'pencil-sketch') {
      return processPencilSketch(source, width, height, parameters);
    } else if (effect === 'dithering') {
      return processDithering(source, width, height, parameters);
    } else if (effect === 'cells') {
      return processCells(source, width, height, parameters);
    } else if (effect === 'clouds') {
      return processClouds(source, width, height, parameters);
    } else if (effect === 'julia-fractal') {
      return processFractal(source, width, height, parameters, 'julia');
    } else if (effect === 'mandelbrot-fractal') {
      return processFractal(source, width, height, parameters, 'mandelbrot');
    } else if (effect === 'voronoi-diagram') {
      return processVoronoi(source, width, height, parameters);
    } else if (effect === 'align-object') {
      return processAlignObject(source, width, height, parameters);
    } else if (effect === 'feather-object') {
      return processFeatherObject(source, width, height, parameters);
    } else if (effect === 'outline-object') {
      return processOutlineObject(source, width, height, parameters);
    } else if (effect === 'glow') {
      return processGlow(source, width, height, parameters);
    } else if (effect === 'red-eye-removal') {
      processRedEyeRemoval(output, parameters);
    } else if (effect === 'sharpen') {
      return processLocalHistogram(source, width, height, parameters, 'sharpen');
    } else if (effect === 'soften-portrait') {
      return processSoftenPortrait(source, width, height, parameters);
    } else if (effect === 'vignette') {
      processVignette(output, width, height, parameters);
    } else if (effect === 'edge-detect') {
      return processDirectionalDifference(source, width, height, value(parameters, 'angle', 45), 0, false);
    } else if (effect === 'emboss') {
      return processDirectionalDifference(source, width, height, value(parameters, 'angle', 0), 0, true);
    } else if (effect === 'outline-edge') {
      return processLocalHistogram(source, width, height, parameters, 'outline-edge');
    } else if (effect === 'relief') {
      return processDirectionalDifference(source, width, height, value(parameters, 'angle', 45), 1, false);
    } else if (effect === 'chromatic-aberration') {
      return processChromaticAberration(source, width, height, parameters);
    } else if (effect === 'scanlines') {
      return processScanlines(source, width, height, parameters);
    } else if (effect === 'colored-artifacts') {
      return processColoredArtifacts(source, width, height, parameters);
    } else if (effect === 'pixel-drag') {
      return processPixelDrag(source, width, height, parameters);
    } else if (effect === 'row-slice') {
      return processRowSlice(source, width, height, parameters);
    } else if (effect === 'adjustment-noise') {
      processAdjustmentNoise(output, parameters);
    } else if (effect === 'colored-grayscale') {
      processColoredGrayscale(output, parameters);
    } else if (effect === 'hexagon-pixelate') {
      return processHexagonPixelate(source, width, height, parameters);
    } else if (effect === 'night-vision') {
      processNightVision(output, parameters);
    }
    return output;
  } finally {
    reportProgress(1, true);
    setProgressReporter(undefined);
  }
}

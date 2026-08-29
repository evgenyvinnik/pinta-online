import { context2d } from './canvasContext';
import { clampByte, cloneCanvas, colorToRgba, makeCanvas } from './canvasUtils';
import { constrainCanvasMutationToSelection, selectionMaskOnCanvas } from './selectionGeometry';
import type {
  AlphaBlendingMode, EditableBoundsTool, EditableLineState, EditableShapeState, EraserType,
  GradientDraftState, GradientType, PaintBrushType, PaintLayer, Point, Selection,
  ShapeDashStyle, ShapeDrawingOptions, ShapeFillStyle, TextDrawingOptions, TextEditorState, TextVariant, ToolId,
} from './types';

export function applyTextVariant(value: string, variant: TextVariant) {
  if (variant === 'all-small-caps' || variant === 'all-petite-caps') return value.toUpperCase();
  if (variant === 'unicase') return value.toLowerCase();
  if (variant === 'title-caps') return value.replace(/\b\w/g, (character) => character.toUpperCase());
  return value;
}

export function textEditorBounds(editor: TextEditorState, options: TextDrawingOptions) {
  const context = context2d(makeCanvas(1, 1));
  const variant = options.variant === 'small-caps' || options.variant === 'petite-caps' ? 'small-caps ' : '';
  context.font = `${options.italic ? 'italic ' : ''}${variant}${options.fontWeight} ${options.fontSize}px "${options.fontFamily}"`;
  const lines = applyTextVariant(editor.value, options.variant).split('\n').map((line) => line.replace(/\t/g, '    '));
  const width = Math.max(1, ...lines.map((line) => context.measureText(line || ' ').width));
  const height = Math.max(options.fontSize * 1.22, lines.length * options.fontSize * 1.22);
  const left = options.alignment === 'center' ? editor.x - width / 2 : options.alignment === 'right' ? editor.x - width : editor.x;
  const inflation = Math.max(3, options.outlineWidth);
  return { x: left - inflation, y: editor.y - inflation, width: width + inflation * 2, height: height + inflation * 2 };
}

export function drawTextEditor(context: CanvasRenderingContext2D, editor: TextEditorState, options: TextDrawingOptions) {
  const variant = options.variant === 'small-caps' || options.variant === 'petite-caps' ? 'small-caps ' : '';
  context.save();
  context.font = `${options.italic ? 'italic ' : ''}${variant}${options.fontWeight} ${options.fontSize}px "${options.fontFamily}"`;
  context.textAlign = options.alignment;
  context.direction = /[\u0590-\u08ff\ufb1d-\ufefc]/.test(editor.value) ? 'rtl' : 'ltr';
  context.textBaseline = 'top';
  context.lineJoin = options.lineJoin;
  context.lineWidth = options.outlineWidth;
  const lineHeight = options.fontSize * 1.22;
  const lines = applyTextVariant(editor.value, options.variant).split('\n');
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex].replace(/\t/g, '    ');
    const y = editor.y + lineIndex * lineHeight;
    const width = context.measureText(line || ' ').width;
    const left = options.alignment === 'center' ? editor.x - width / 2 : options.alignment === 'right' ? editor.x - width : editor.x;
    if (options.style === 'background') {
      context.fillStyle = options.secondary;
      context.fillRect(left - 2, y - 1, width + 4, lineHeight);
    }
    if (options.style === 'fill' || options.style === 'fill-outline' || options.style === 'background') {
      if (options.style === 'fill-outline') {
        context.strokeStyle = options.secondary;
        context.strokeText(line, editor.x, y);
      }
      context.fillStyle = options.primary;
      context.fillText(line, editor.x, y);
    } else {
      context.strokeStyle = options.primary;
      context.strokeText(line, editor.x, y);
    }
    if (options.underline && line) {
      context.strokeStyle = options.primary;
      context.lineWidth = Math.max(1, options.fontSize / 15);
      context.beginPath();
      context.moveTo(left, y + options.fontSize * 1.05);
      context.lineTo(left + width, y + options.fontSize * 1.05);
      context.stroke();
      context.lineWidth = options.outlineWidth;
    }
  }
  context.restore();
}

export function drawRoundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, requestedRadius: number) {
  const radius = Math.min(requestedRadius, Math.abs(width) / 2, Math.abs(height) / 2);
  context.roundRect(x, y, width, height, radius);
}

export function shapeDashPattern(style: ShapeDashStyle, size: number) {
  const legacyPatterns: Record<string, string> = {
    dash: ' ---',
    dot: ' -',
    'dash-dot': ' --- -',
  };
  const value = legacyPatterns[style] ?? style;
  if (!value.includes('-') || value === '-') return { dashes: [] as number[], offset: 0 };
  const unit = Math.max(1, size);
  const runs: number[] = [];
  let currentIsDash = value[0] === '-';
  let count = 0;
  for (const character of value) {
    const isDash = character === '-';
    if (isDash !== currentIsDash) {
      runs.push(count);
      count = 0;
      currentIsDash = isDash;
    }
    count += 1;
  }
  runs.push(count);
  if (value.endsWith('-')) runs.push(0);

  let offsetFromEnd: number | null = null;
  if (!value.startsWith('-')) {
    offsetFromEnd = runs.shift() ?? 0;
    runs[runs.length - 1] += offsetFromEnd;
  }
  const dashes = runs.map((run, index) => index % 2 === 0
    ? Math.max(run * unit - unit, 1)
    : run * unit + unit);
  return {
    dashes,
    offset: offsetFromEnd === null ? 0 : dashes.reduce((sum, dash) => sum + dash, 0) - (offsetFromEnd * unit + unit / 2),
  };
}

export function configureShape(context: CanvasRenderingContext2D, options: ShapeDrawingOptions) {
  const outline = options.reverseColors ? options.secondary : options.primary;
  const fill = options.reverseColors ? options.primary : options.secondary;
  context.strokeStyle = outline;
  context.fillStyle = fill;
  context.lineWidth = options.size;
  context.lineCap = 'square';
  context.lineJoin = 'round';
  const dash = shapeDashPattern(options.dashStyle, options.size);
  context.setLineDash(dash.dashes);
  context.lineDashOffset = dash.offset;
}

export function strokeAndFillShape(context: CanvasRenderingContext2D, fillStyle: ShapeFillStyle) {
  if (fillStyle === 'fill') {
    context.fillStyle = context.strokeStyle;
    context.fill('evenodd');
  } else if (fillStyle === 'fill-outline') {
    context.fill('evenodd');
    context.stroke();
  } else {
    context.stroke();
  }
}

export function traceCardinalCurve(context: CanvasRenderingContext2D, points: Point[], tensions: number[]) {
  if (!points.length) return;
  context.moveTo(points[0].x, points[0].y);
  if (points.length === 1) return;
  if (points.length === 2) {
    context.lineTo(points[1].x, points[1].y);
    return;
  }
  const lastIndex = points.length - 1;
  const tangents = points.map((point, index) => {
    const tension = Math.max(0, Math.min(1, tensions[index] ?? (index === 0 || index === lastIndex ? 0 : 1 / 3)));
    if (index === 0) return {
      x: tension * (points[1].x - point.x),
      y: tension * (points[1].y - point.y),
    };
    if (index === lastIndex) return {
      x: tension * (point.x - points[index - 1].x),
      y: tension * (point.y - points[index - 1].y),
    };
    const gradedTension = tension * index / lastIndex;
    return {
      x: gradedTension * (points[index + 1].x - points[index - 1].x),
      y: gradedTension * (points[index + 1].y - points[index - 1].y),
    };
  });
  for (let index = 0; index < lastIndex; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    context.bezierCurveTo(
      current.x + tangents[index].x,
      current.y + tangents[index].y,
      next.x - tangents[index + 1].x,
      next.y - tangents[index + 1].y,
      next.x,
      next.y,
    );
  }
}

export function drawArrowHead(context: CanvasRenderingContext2D, tip: Point, neighbor: Point, size: number, angleDegrees: number, lengthValue: number) {
  const arrowSize = Math.max(1, Number.isFinite(size) ? size : 10);
  const angleOffset = Math.max(-89, Math.min(89, Number.isFinite(angleDegrees) ? angleDegrees : 15));
  const lengthOffset = Math.max(-100, Math.min(100, Number.isFinite(lengthValue) ? lengthValue : 10));
  const dx = tip.x - neighbor.x;
  const dy = tip.y - neighbor.y;
  let endingAngle = Math.atan(Math.abs(dy) / Math.abs(dx)) * 180 / Math.PI;
  if (dy > 0) {
    if (dx > 0) endingAngle = 180 - endingAngle;
  } else if (dx > 0) {
    endingAngle += 180;
  } else {
    endingAngle = 360 - endingAngle;
  }
  const arrowPoint = (degrees: number, length: number): Point => ({
    x: tip.x + Math.cos(degrees * Math.PI / 180) * length,
    y: tip.y - Math.sin(degrees * Math.PI / 180) * length,
  });
  const firstWing = arrowPoint(endingAngle + 270 + angleOffset, arrowSize);
  const lengthPoint = arrowPoint(endingAngle + 180, arrowSize + lengthOffset);
  const secondWing = arrowPoint(endingAngle + 90 - angleOffset, arrowSize);
  context.save();
  context.setLineDash([]);
  context.beginPath();
  context.moveTo(tip.x, tip.y);
  context.lineTo(firstWing.x, firstWing.y);
  context.lineTo(lengthPoint.x, lengthPoint.y);
  context.lineTo(secondWing.x, secondWing.y);
  context.closePath();
  context.fillStyle = context.strokeStyle;
  context.fill();
  context.restore();
}

export function drawEditableLine(context: CanvasRenderingContext2D, line: EditableLineState, options: ShapeDrawingOptions, showHandles = false, zoom = 1) {
  if (line.points.length < 2) return;
  context.save();
  configureShape(context, { ...options, reverseColors: line.reverseColors });
  context.beginPath();
  traceCardinalCurve(context, line.points, line.tensions);
  context.stroke();
  if (options.arrowStart) drawArrowHead(context, line.points[0], line.points[1], options.arrowSize, options.arrowAngle, options.arrowLength);
  if (options.arrowEnd) drawArrowHead(context, line.points.at(-1)!, line.points.at(-2)!, options.arrowSize, options.arrowAngle, options.arrowLength);
  if (showHandles) {
    const radius = Math.max(3, 5 / zoom);
    context.setLineDash([]);
    line.points.forEach((point, index) => {
      context.beginPath();
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.fillStyle = index === line.selectedPoint ? '#4da3ff' : '#ffffff';
      context.fill();
      context.strokeStyle = '#17324d';
      context.lineWidth = Math.max(1, 1 / zoom);
      context.stroke();
    });
  }
  context.restore();
}

export function drawEditableShape(context: CanvasRenderingContext2D, shape: EditableShapeState, options: ShapeDrawingOptions, showHandles = false, zoom = 1) {
  const start = shape.points[0];
  const end = shape.points[2];
  drawShape(context, shape.tool, start, end, { ...options, reverseColors: shape.reverseColors });
  if (!showHandles) return;
  context.save();
  context.setLineDash([]);
  const radius = Math.max(3, 5 / zoom);
  shape.points.forEach((point, index) => {
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.fillStyle = index === shape.selectedPoint ? '#4da3ff' : '#ffffff';
    context.fill();
    context.strokeStyle = '#17324d';
    context.lineWidth = Math.max(1, 1 / zoom);
    context.stroke();
  });
  context.restore();
}

export function rectangularControlPoints(start: Point, end: Point): [Point, Point, Point, Point] {
  return [
    { x: start.x, y: start.y },
    { x: start.x, y: end.y },
    { x: end.x, y: end.y },
    { x: end.x, y: start.y },
  ];
}

export function moveRectangularControlPoint(shape: EditableShapeState, index: number, point: Point): EditableShapeState {
  const points = shape.points.map((candidate) => ({ ...candidate })) as [Point, Point, Point, Point];
  points[index] = point;
  if (index === 0) {
    points[1].x = point.x;
    points[3].y = point.y;
  } else if (index === 1) {
    points[0].x = point.x;
    points[2].y = point.y;
  } else if (index === 2) {
    points[1].y = point.y;
    points[3].x = point.x;
  } else {
    points[0].y = point.y;
    points[2].x = point.x;
  }
  return { ...shape, points, selectedPoint: index };
}

export function drawFreeformShape(context: CanvasRenderingContext2D, points: Point[], options: ShapeDrawingOptions) {
  if (points.length < 2) return;
  context.save();
  configureShape(context, options);
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  context.closePath();
  strokeAndFillShape(context, options.fillStyle);
  context.restore();
}

export function removeAntialiasing(context: CanvasRenderingContext2D, fullCoverageAlpha = 255) {
  const image = context.getImageData(0, 0, context.canvas.width, context.canvas.height);
  for (let index = 3; index < image.data.length; index += 4) {
    const alpha = image.data[index];
    if (alpha === 0 || alpha >= fullCoverageAlpha) continue;
    image.data[index] = alpha < fullCoverageAlpha / 2 ? 0 : fullCoverageAlpha;
  }
  context.putImageData(image, 0, 0);
}

export function constrainLinePoint(start: Point, point: Point) {
  const dx = point.x - start.x;
  const dy = point.y - start.y;
  const distance = Math.hypot(dx, dy);
  if (!distance) return point;
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: start.x + Math.cos(angle) * distance, y: start.y + Math.sin(angle) * distance };
}

export function constrainShapePoint(start: Point, point: Point) {
  const dx = point.x - start.x;
  const dy = point.y - start.y;
  const extent = Math.max(Math.abs(dx), Math.abs(dy));
  return {
    x: start.x + Math.sign(dx || 1) * extent,
    y: start.y + Math.sign(dy || 1) * extent,
  };
}

export function distanceToSegment(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point.x - start.x, point.y - start.y);
  const amount = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + amount * dx), point.y - (start.y + amount * dy));
}

export function distanceToLineDraft(point: Point, draft: EditableLineState) {
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < draft.points.length - 1; index += 1) {
    distance = Math.min(distance, distanceToSegment(point, draft.points[index], draft.points[index + 1]));
  }
  return distance;
}

export function distanceToShapeDraft(point: Point, draft: EditableShapeState) {
  const left = Math.min(draft.points[0].x, draft.points[2].x);
  const right = Math.max(draft.points[0].x, draft.points[2].x);
  const top = Math.min(draft.points[0].y, draft.points[2].y);
  const bottom = Math.max(draft.points[0].y, draft.points[2].y);
  if (draft.tool === 'ellipse') {
    const radiusX = Math.max(0.001, (right - left) / 2);
    const radiusY = Math.max(0.001, (bottom - top) / 2);
    const centerX = left + radiusX;
    const centerY = top + radiusY;
    const normalizedRadius = Math.hypot((point.x - centerX) / radiusX, (point.y - centerY) / radiusY);
    return Math.abs(normalizedRadius - 1) * Math.min(radiusX, radiusY);
  }
  const corners = rectangularControlPoints({ x: left, y: top }, { x: right, y: bottom });
  return Math.min(
    distanceToSegment(point, corners[0], corners[1]),
    distanceToSegment(point, corners[1], corners[2]),
    distanceToSegment(point, corners[2], corners[3]),
    distanceToSegment(point, corners[3], corners[0]),
  );
}

export function isRenderableLineDraft(draft: EditableLineState | null) {
  return Boolean(draft && draft.points.length >= 2 && Math.hypot(
    draft.points.at(-1)!.x - draft.points[0].x,
    draft.points.at(-1)!.y - draft.points[0].y,
  ) >= 0.5);
}

export function isRenderableShapeDraft(draft: EditableShapeState | null) {
  return Boolean(draft && Math.abs(draft.points[2].x - draft.points[0].x) >= 0.5 &&
    Math.abs(draft.points[2].y - draft.points[0].y) >= 0.5);
}

export function configureStroke(
  context: CanvasRenderingContext2D,
  tool: ToolId,
  color: string,
  size: number,
  eraserType: EraserType,
  alphaBlendingMode: AlphaBlendingMode,
) {
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = tool === 'pencil' ? 1 : size;
  context.lineCap = tool === 'pencil' ? 'butt' : 'round';
  context.lineJoin = 'round';
  context.globalCompositeOperation = tool === 'eraser'
    ? 'destination-out'
    : tool === 'pencil' && alphaBlendingMode === 'overwrite'
      ? 'copy'
      : 'source-over';
  context.globalAlpha = tool === 'eraser' && eraserType === 'smooth' ? 0.45 : 1;
}

export function drawPaintBrushSegment(
  context: CanvasRenderingContext2D,
  type: PaintBrushType,
  from: Point,
  to: Point,
  color: string,
  size: number,
  slashAngle: number,
  splatterMinimumSize: number,
  splatterMaximumSize: number,
) {
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = size;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.beginPath();
  if (type === 'normal') {
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
    return;
  }
  if (type === 'block') {
    const blockSize = Math.max(1, Math.round(size));
    context.fillRect(Math.round(to.x - blockSize / 2), Math.round(to.y - blockSize / 2), blockSize, blockSize);
    return;
  }
  if (type === 'squares') {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    context.moveTo(from.x + dy, from.y - dx);
    context.lineTo(from.x - dy, from.y + dx);
    context.lineTo(to.x - dy, to.y + dx);
    context.lineTo(to.x + dy, to.y - dx);
    context.closePath();
    context.stroke();
    return;
  }
  if (type === 'circles') {
    const centerX = Math.floor(to.x / 100) * 100 + 50;
    const centerY = Math.floor(to.y / 100) * 100 + 50;
    const diameter = Math.hypot(to.x - from.x, to.y - from.y) * 2;
    const steps = Math.floor(Math.random() * 9) + 1;
    const stepDelta = diameter / steps;
    context.globalAlpha *= 0.05;
    for (let index = 0; index < steps; index += 1) {
      context.beginPath();
      context.arc(centerX, centerY, (steps - index) * stepDelta, 0, Math.PI * 2);
      context.stroke();
    }
    return;
  }
  if (type === 'grid') {
    const centerX = Math.round(to.x / 100) * 100;
    const centerY = Math.round(to.y / 100) * 100;
    const deltaX = (centerX - to.x) * 10;
    const deltaY = (centerY - to.y) * 10;
    context.globalAlpha *= 0.05;
    for (let index = 0; index < 50; index += 1) {
      context.beginPath();
      context.moveTo(centerX, centerY);
      context.quadraticCurveTo(to.x + Math.random() * deltaX, to.y + Math.random() * deltaY, centerX, centerY);
      context.stroke();
    }
    return;
  }
  if (type === 'splatter') {
    const maximum = Math.max(1, Math.round(splatterMaximumSize));
    const minimum = Math.min(maximum, Math.max(1, Math.round(splatterMinimumSize)));
    const diameter = minimum === maximum ? minimum : minimum + Math.floor(Math.random() * (maximum - minimum));
    const halfLineWidth = Math.trunc(size / 2);
    const randomOffset = () => halfLineWidth <= 0 ? 0 : Math.floor(Math.random() * halfLineWidth * 2) - halfLineWidth;
    const centerX = to.x - randomOffset() + diameter / 2;
    const centerY = to.y - randomOffset() + diameter / 2;
    context.beginPath();
    context.ellipse(centerX, centerY, diameter / 2, diameter / 2, 0, 0, Math.PI * 2);
    context.fill();
    return;
  }
  const angle = slashAngle * Math.PI / 180;
  const offsetPoint = (point: Point, multiplier: number, offset: number, offsetAngle = angle): Point => ({
    x: Math.round(point.x + multiplier * offset * Math.sin(offsetAngle)),
    y: Math.round(point.y + multiplier * offset * Math.cos(offsetAngle)),
  });
  let oldTop = offsetPoint(from, -1, size / 2);
  let oldBottom = offsetPoint(from, 1, size / 2);
  let newTop = offsetPoint(to, -1, size / 2);
  let newBottom = offsetPoint(to, 1, size / 2);
  const area = Math.abs(0.5 * (
    oldTop.x * newTop.y - oldTop.y * newTop.x +
    newTop.x * newBottom.y - newTop.y * newBottom.x +
    newBottom.x * oldBottom.y - newBottom.y * oldBottom.x +
    oldBottom.x * oldTop.y - oldBottom.y * oldTop.x
  ));
  if (area < 2 && (from.x !== to.x || from.y !== to.y)) {
    oldTop = offsetPoint(oldTop, -1, 1, angle + Math.PI / 2);
    newTop = offsetPoint(newTop, -1, 1, angle + Math.PI / 2);
    oldBottom = offsetPoint(oldBottom, 1, 1, angle + Math.PI / 2);
    newBottom = offsetPoint(newBottom, 1, 1, angle + Math.PI / 2);
  }
  context.beginPath();
  context.moveTo(oldTop.x, oldTop.y);
  context.lineTo(newTop.x, newTop.y);
  context.lineTo(newBottom.x, newBottom.y);
  context.lineTo(oldBottom.x, oldBottom.y);
  context.closePath();
  context.fill();
}

export function gradientAmount(type: GradientType, start: Point, end: Point, x: number, y: number) {
  const vectorX = end.x - start.x;
  const vectorY = end.y - start.y;
  const magnitudeSquared = vectorX * vectorX + vectorY * vectorY;
  if (type === 'radial') {
    if (magnitudeSquared === 0) return 1;
    return Math.min(1, Math.hypot(x - Math.trunc(start.x), y - Math.trunc(start.y)) / Math.sqrt(magnitudeSquared));
  }
  if (type === 'conical') {
    const offset = -Math.atan2(vectorY, vectorX) / Math.PI;
    let amount = Math.atan2(y - start.y, x - start.x) / Math.PI + offset;
    if (amount > 1) amount -= 2;
    else if (amount < -1) amount += 2;
    return Math.min(1, Math.abs(amount));
  }
  if (magnitudeSquared === 0) return 1;
  const dtdx = vectorX / magnitudeSquared;
  const dtdy = vectorY / magnitudeSquared;
  if (type === 'diamond') {
    const dx = x - start.x;
    const dy = y - start.y;
    return Math.min(1, Math.abs(dx * dtdx + dy * dtdy) + Math.abs(dx * dtdy - dy * dtdx));
  }
  const amount = (x - Math.trunc(start.x)) * dtdx + (y - Math.trunc(start.y)) * dtdy;
  return Math.min(1, Math.max(0, type === 'reflected' ? Math.abs(amount) : amount));
}

export function drawGradientPixels(
  context: CanvasRenderingContext2D,
  start: Point,
  end: Point,
  options: ShapeDrawingOptions,
) {
  const startColor = colorToRgba(options.reverseColors ? options.secondary : options.primary);
  const requestedEnd = colorToRgba(options.reverseColors ? options.primary : options.secondary);
  const endColor = options.gradientColorMode === 'transparency'
    ? { ...startColor, a: Math.max(0, 255 - requestedEnd.a) }
    : requestedEnd;
  const image = context.createImageData(context.canvas.width, context.canvas.height);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const amount = gradientAmount(options.gradientType, start, end, x, y);
      const index = (y * image.width + x) * 4;
      image.data[index] = clampByte(startColor.r + (endColor.r - startColor.r) * amount);
      image.data[index + 1] = clampByte(startColor.g + (endColor.g - startColor.g) * amount);
      image.data[index + 2] = clampByte(startColor.b + (endColor.b - startColor.b) * amount);
      image.data[index + 3] = clampByte(startColor.a + (endColor.a - startColor.a) * amount);
    }
  }
  context.putImageData(image, 0, 0);
}

export function renderGradientDraftToLayer(
  layer: PaintLayer,
  draft: GradientDraftState,
  alphaBlendingMode: AlphaBlendingMode,
) {
  const width = layer.canvas.width;
  const height = layer.canvas.height;
  const rendered = makeCanvas(width, height);
  drawGradientPixels(context2d(rendered), draft.start, draft.end, {
    ...draft.options,
    reverseColors: draft.reverseColors,
  });

  if (draft.options.gradientColorMode === 'transparency') {
    const baseContext = context2d(draft.baseCanvas);
    const base = baseContext.getImageData(0, 0, width, height);
    const alpha = context2d(rendered).getImageData(0, 0, width, height);
    for (let index = 0; index < base.data.length; index += 4) {
      base.data[index + 3] = alphaBlendingMode === 'normal'
        ? clampByte(base.data[index + 3] * alpha.data[index + 3] / 255)
        : alpha.data[index + 3];
    }
    context2d(rendered).putImageData(base, 0, 0);
  }

  const mask = draft.selection
    ? selectionMaskOnCanvas(draft.selection, width, height)
    : (() => {
      const full = makeCanvas(width, height);
      const context = context2d(full);
      context.fillStyle = '#fff';
      context.fillRect(0, 0, width, height);
      return full;
    })();
  const renderedContext = context2d(rendered);
  renderedContext.globalCompositeOperation = 'destination-in';
  renderedContext.drawImage(mask, 0, 0);

  const merged = cloneCanvas(draft.baseCanvas);
  const mergedContext = context2d(merged);
  const startColor = colorToRgba(draft.reverseColors ? draft.options.secondary : draft.options.primary);
  const endColor = colorToRgba(draft.reverseColors ? draft.options.primary : draft.options.secondary);
  const blendsColor = draft.options.gradientColorMode === 'color' && alphaBlendingMode === 'normal' &&
    (startColor.a !== 255 || endColor.a !== 255);
  if (!blendsColor) {
    mergedContext.globalCompositeOperation = 'destination-out';
    mergedContext.drawImage(mask, 0, 0);
    mergedContext.globalCompositeOperation = 'source-over';
  }
  mergedContext.drawImage(rendered, 0, 0);

  const layerContext = context2d(layer.canvas);
  layerContext.save();
  layerContext.globalCompositeOperation = 'copy';
  layerContext.drawImage(merged, 0, 0);
  layerContext.restore();
}

export function drawShape(
  context: CanvasRenderingContext2D,
  tool: ToolId,
  start: Point,
  end: Point,
  options: ShapeDrawingOptions,
) {
  context.save();
  configureShape(context, options);
  const width = end.x - start.x;
  const height = end.y - start.y;
  context.beginPath();

  if (tool === 'line') {
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
  } else if (tool === 'rectangle') {
    context.rect(start.x, start.y, width, height);
    strokeAndFillShape(context, options.fillStyle);
  } else if (tool === 'rounded-rectangle') {
    drawRoundedRect(context, start.x, start.y, width, height, options.roundedRadius);
    strokeAndFillShape(context, options.fillStyle);
  } else if (tool === 'ellipse') {
    context.ellipse(
      start.x + width / 2,
      start.y + height / 2,
      Math.abs(width / 2),
      Math.abs(height / 2),
      0,
      0,
      Math.PI * 2,
    );
    strokeAndFillShape(context, options.fillStyle);
  } else if (tool === 'gradient') {
    drawGradientPixels(context, start, end, options);
  }
  context.restore();
}

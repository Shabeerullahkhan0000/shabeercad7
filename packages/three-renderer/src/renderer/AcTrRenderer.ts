import {
  AcCmEventManager,
  AcGeArea2d,
  AcGeCircArc3d,
  AcGeEllipseArc3d,
  AcGePoint3d,
  AcGePoint3dLike,
  AcGiFontMapping,
  AcGiImageStyle,
  AcGiMTextData,
  AcGiPointStyle,
  AcGiRenderer,
  AcGiSubEntityTraits,
  AcGiTextStyle
} from '@mlightcad/data-model'
import { FontManager, FontManagerEventArgs } from '@mlightcad/mtext-renderer'
import * as THREE from 'three'

import {
  AcTrEntity,
  AcTrGroup,
  AcTrImage,
  AcTrLine,
  AcTrLineSegments,
  AcTrMText,
  AcTrObject,
  AcTrPoint,
  AcTrPolygon,
  AcTrRasterMask
} from '../object'
import { AcTrMaterialManager } from '../style/AcTrMaterialManager'
import { AcTrStyleManager } from '../style/AcTrStyleManager'
import type { AcTrHatchRenderingWarning } from '../style/AcTrStyleManagerOptions'
import { AcTrSubEntityTraitsUtil } from '../util'
import { AcTrCamera } from '../viewport'
import { AcTrMTextRenderer } from './AcTrMTextRenderer'

export class AcTrRenderer implements AcGiRenderer<AcTrEntity> {
  private static readonly DISPLAY_ORDER_Z_STEP = 1e-5

  private _styleManager: AcTrStyleManager
  private _renderer: THREE.WebGLRenderer
  private _subEntityTraits: AcGiSubEntityTraits
  private _displayOrderIndex = 0

  public readonly events = {
    fontNotFound: new AcCmEventManager<FontManagerEventArgs>(),
    hatchRenderWarning: new AcCmEventManager<AcTrHatchRenderingWarning>()
  }

  constructor(renderer: THREE.WebGLRenderer) {
    this._renderer = renderer
    this._styleManager = new AcTrStyleManager()
    this._styleManager.options.maxFragmentUniforms =
      this.resolveFragmentUniformBudget(renderer)
    this._styleManager.options.onHatchRenderingWarning = warning => {
      this.events.hatchRenderWarning.dispatch(warning)
    }
    const size = renderer.getSize(new THREE.Vector2())
    this._styleManager.updateLineResolution(size.x, size.y)
    AcTrMTextRenderer.getInstance().overrideStyleManager(this._styleManager)
    FontManager.instance.events.fontNotFound.addEventListener(args => {
      this.events.fontNotFound.dispatch(args)
    })
    this._subEntityTraits = AcTrSubEntityTraitsUtil.createDefaultTraits()
  }

  /**
   * @inheritdoc
   */
  get subEntityTraits() {
    return this._subEntityTraits
  }

  get autoClear() {
    return this._renderer.autoClear
  }
  set autoClear(value: boolean) {
    this._renderer.autoClear = value
  }

  get domElement() {
    return this._renderer.domElement
  }

  setSize(width: number, height: number) {
    this._renderer.setSize(width, height)
    this._styleManager.updateLineResolution(width, height)
  }

  getViewport(target: THREE.Vector4) {
    return this._renderer.getViewport(target)
  }
  setViewport(x: number, y: number, width: number, height: number) {
    this._renderer.setViewport(x, y, width, height)
  }

  clear() {
    this._renderer.clear()
  }

  clearDepth() {
    this._renderer.clearDepth()
  }

  render(scene: THREE.Object3D, camera: AcTrCamera) {
    this.updateCameraZoomUniform(camera.zoom)
    this._renderer.render(scene, camera.internalCamera)
  }

  /**
   * Changes rendering color to the specified color for entities whose color is ACI 7.
   * @param color - New rendering color for ACI 7.
   */
  changeForeground(color: number) {
    this._styleManager.changeForeground(color)
  }

  /**
   * Repaints materials explicitly registered as background-follow fills.
   *
   * The current fill manager keeps solid hatches on the foreground path, so
   * this is mostly an extension point for future fill styles.
   *
   * @param color - New background color (typically the canvas bg).
   */
  changeBackground(color: number) {
    this._styleManager.changeBackground(color)
  }

  /**
   * The canvas background colour tracked by the style manager.
   *
   * Reading returns the value last written here (or the default
   * `0x000000`).  Writing both stores the colour on the style manager
   * options (so material managers know the current theme) and repaints
   * every background-follow material already in the cache.
   */
  get currentBackgroundColor(): number {
    return this._styleManager.currentBackgroundColor
  }
  set currentBackgroundColor(value: number) {
    this._styleManager.currentBackgroundColor = value
  }

  /**
   * Sets the clear color used when clearing the canvas.
   *
   * @param color - Background color as 24-bit hexadecimal RGB number
   * @param alpha - Optional alpha value (0.0 - 1.0)
   */
  setClearColor(color: number, alpha?: number) {
    this._renderer.setClearColor(color, alpha)
  }

  /**
   * Gets the current clear color as a 24-bit hexadecimal RGB number.
   */
  getClearColor() {
    const color = new THREE.Color()
    this._renderer.getClearColor(color)
    return color.getHex()
  }

  /**
   * Sets the clear alpha used when clearing the canvas.
   *
   * @param alpha - Alpha value (0.0 - 1.0)
   */
  set clearAlpha(alpha: number) {
    this._renderer.setClearAlpha(alpha)
  }

  /**
   * Gets the current clear alpha value.
   */
  get clearAlpha() {
    return this._renderer.getClearAlpha()
  }

  /**
   * The internal THREE.js webgl renderer
   */
  get internalRenderer() {
    return this._renderer
  }

  /**
   * @inheritdoc
   */
  setFontMapping(mapping: AcGiFontMapping) {
    FontManager.instance.setFontMapping(mapping)
  }

  /**
   * Sets global ltscale
   */
  set ltscale(scale: number) {
    this._styleManager.options.ltscale = scale
  }

  /**
   * Sets global celtscale
   */
  set celtscale(scale: number) {
    this._styleManager.options.celtscale = scale
  }

  /**
   * Fonts list which can't be found
   */
  get missedFonts() {
    return FontManager.instance.missedFonts
  }

  /**
   * Gets whether entity lineweights are displayed.
   */
  get showLineWeight() {
    return this._styleManager.showLineWeight
  }

  /**
   * Sets whether entity lineweights are displayed.
   *
   * When disabled, line entities are rendered with basic 1px materials.
   */
  set showLineWeight(value: boolean) {
    this._styleManager.showLineWeight = value
  }

  updateLayerMaterial(
    layerName: string,
    newTraits: Partial<AcGiSubEntityTraits>
  ): Record<number, THREE.Material> {
    return this._styleManager.updateLayerMaterial(layerName, newTraits)
  }

  /**
   * Returns one cached material bound to an effective layer while preserving symbolic traits.
   *
   * This is used for block contents that inherit the layer of the INSERT they belong to.
   */
  getLayerBoundMaterial(
    material: THREE.Material,
    layerName: string,
    layerTraits?: Partial<AcGiSubEntityTraits>
  ) {
    return this._styleManager.getLayerBoundMaterial(
      material,
      layerName,
      layerTraits
    )
  }

  /**
   * Create one empty drawable object
   */
  createObject() {
    return new AcTrObject(this._styleManager)
  }

  /**
   * Create one empty entity
   */
  createEntity() {
    return new AcTrEntity(this._styleManager)
  }

  /**
   * @inheritdoc
   */
  group(entities: AcTrEntity[]) {
    return this.stampDisplayOrder(new AcTrGroup(entities, this._styleManager))
  }

  /**
   * @inheritdoc
   */
  point(point: AcGePoint3d, style: AcGiPointStyle) {
    const geometry = new AcTrPoint(
      point,
      this._subEntityTraits,
      style,
      this._styleManager
    )
    return this.stampDisplayOrder(geometry)
  }

  /**
   * @inheritdoc
   */
  circularArc(arc: AcGeCircArc3d) {
    // TODO: Compute division based on current viewport size
    return this.linePoints(arc.getPoints(100))
  }

  /**
   * @inheritdoc
   */
  ellipticalArc(ellipseArc: AcGeEllipseArc3d) {
    // TODO: Compute division based on current viewport size
    return this.linePoints(ellipseArc.getPoints(100))
  }

  /**
   * @inheritdoc
   */
  lines(points: AcGePoint3dLike[]) {
    return this.linePoints(points)
  }

  /**
   * @inheritdoc
   */
  lineSegments(array: Float32Array, itemSize: number, indices: Uint16Array) {
    return this.stampDisplayOrder(
      new AcTrLineSegments(
        array,
        itemSize,
        indices,
        this._subEntityTraits,
        this._styleManager
      )
    )
  }

  /**
   * @inheritdoc
   */
  area(area: AcGeArea2d) {
    return this.stampDisplayOrder(
      new AcTrPolygon(area, this._subEntityTraits, this._styleManager)
    )
  }

  /**
   * Renders a solid raster mask such as WIPEOUT without using the hatch
   * boundary hierarchy/boolean pipeline.
   */
  rasterMask(points: AcGePoint3dLike[]) {
    return this.stampDisplayOrder(
      new AcTrRasterMask(points, this._subEntityTraits, this._styleManager)
    )
  }

  /**
   * @inheritdoc
   */
  mtext(mtext: AcGiMTextData, style: AcGiTextStyle, delay?: boolean) {
    return this.stampDisplayOrder(
      new AcTrMText(
        mtext,
        this._subEntityTraits,
        style,
        this._styleManager,
        delay
      )
    )
  }

  /**
   * @inheritdoc
   */
  image(blob: Blob, style: AcGiImageStyle) {
    return this.stampDisplayOrder(
      new AcTrImage(blob, style, this._styleManager)
    )
  }

  /**
   * Clears all cached materials and releases its memory
   */
  dispose() {
    this._styleManager.dispose()
    this._styleManager.resetHatchRenderingWarnings()
    this.resetDisplayOrder()
    FontManager.instance.missedFonts = {}
  }

  /**
   * Clears per-document hatch warning log de-duplication.
   */
  resetHatchRenderingWarnings() {
    this._styleManager.resetHatchRenderingWarnings()
  }

  /**
   * Applies a tiny, invisible Z bias so same-plane CAD primitives retain
   * traversal order after batching. This lets WIPEOUT masks cover earlier
   * floor-pattern linework while later block linework can still appear on top.
   */
  stampDisplayOrder<T extends AcTrEntity>(entity: T) {
    const index = this._displayOrderIndex++
    const zOffset = index * AcTrRenderer.DISPLAY_ORDER_Z_STEP
    entity.position.z += zOffset
    entity.userData.displayOrderIndex = index
    entity.updateMatrix()
    return entity
  }

  resetDisplayOrder() {
    this._displayOrderIndex = 0
  }

  private linePoints(points: AcGePoint3dLike[]) {
    return this.stampDisplayOrder(
      new AcTrLine(points, this._subEntityTraits, this._styleManager)
    )
  }

  /**
   * Updates camera zoom value for shader materials
   */
  private updateCameraZoomUniform(zoom: number) {
    // DxfLoader.CameraZoomUniform.value = (zoom * this.container.height) / 50;
    AcTrMaterialManager.CameraZoomUniform.value = zoom
  }

  private resolveFragmentUniformBudget(renderer: THREE.WebGLRenderer) {
    const gl = renderer.getContext()
    const rawLimit = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS)
    const vectorLimit =
      typeof rawLimit === 'number' ? rawLimit : Number(rawLimit)

    if (!Number.isFinite(vectorLimit) || vectorLimit <= 0) {
      return this._styleManager.options.maxFragmentUniforms
    }

    // Leave headroom for Three.js built-ins, clipping uniforms, and browser
    // driver variance. Hatch patterns that exceed this are simplified.
    return Math.max(8, Math.floor(vectorLimit * 0.9))
  }
}

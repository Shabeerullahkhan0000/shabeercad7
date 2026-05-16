import * as THREE from 'three'

export type AcTrHatchRenderingWarningKind =
  | 'invalid-boundary'
  | 'triangulation-failed'
  | 'hole-merge-empty'
  | 'hole-merge-failed'
  | 'pattern-line-invalid'
  | 'pattern-line-skipped'
  | 'pattern-truncated'
  | 'pattern-segments-truncated'
  | 'pattern-empty'

export interface AcTrHatchRenderingWarning {
  kind: AcTrHatchRenderingWarningKind
  message: string
  details?: Record<string, unknown>
}

export interface AcTrStyleManagerOptions {
  // /** Uniform used by line and hatch shaders to support zoom-dependent effects. */
  // cameraZoomUniform: number

  /**
   * Global ltscale
   */
  ltscale: number
  /**
   * Global celtscale
   */
  celtscale: number

  /** Uniform that accounts for viewport scale in line-pattern rendering. */
  viewportScaleUniform: number

  /**
   * WebGL has a limited capability for FragmentUniforms. Thus, cannot have as many
   * clippingPlanes as expected.
   */
  maxFragmentUniforms: number

  /**
   * Receives recoverable hatch rendering warnings. Callers can surface a user-facing
   * notice while the renderer silently simplifies or skips the problematic hatch.
   */
  onHatchRenderingWarning?: (warning: AcTrHatchRenderingWarning) => void

  /**
   * Viewport size used by fat-line materials.
   */
  resolution: THREE.Vector2

  /**
   * Whether to render entity lineweights using fat-line materials.
   *
   * - `true`: render lineweights (AutoCAD-like lineweight display on)
   * - `false`: force basic line materials with 1px width
   */
  showLineWeight: boolean

  /**
   * Current canvas background colour, as a 24-bit RGB number.
   *
   * Used by material managers to initialize theme-sensitive colours, such
   * as ACI 7 foreground inversion.
   *
   * Kept in sync with `AcTrView2d.backgroundColor` via
   * `AcTrStyleManager.currentBackgroundColor`.
   *
   * Default is `0x000000` (matches the default view bg in
   * `DEFAULT_VIEW_2D_OPTIONS`).
   */
  currentBackgroundColor: number
}

import {
  AcApDocManager,
  AcApOpenDatabaseOptions,
  AcEdOpenMode,
  eventBus
} from '@mlightcad/cad-simple-viewer'
import {
  AcDbSystemVariables,
  AcDbSysVarManager,
  log,
  setLogLevel
} from '@mlightcad/data-model'

const enableCadDebugLogs =
  import.meta.env.DEV &&
  (new URLSearchParams(window.location.search).has('cadDebug') ||
    window.localStorage.getItem('cadDebug') === '1')
setLogLevel(
  import.meta.env.DEV ? (enableCadDebugLogs ? 'debug' : 'warn') : 'error'
)

/**
 * Demo-only command alias overrides used by the example app.
 *
 * Purpose:
 * - Provide visible alias differences from built-in defaults so the alias
 *   feature can be validated quickly in command line UI and execution flow.
 *
 * Behavior:
 * - This object is passed to `AcApDocManager.createInstance({ commandAliases })`.
 * - For commands listed here, these aliases replace the built-in defaults.
 * - Commands not listed keep their built-in alias set.
 */
const EXAMPLE_COMMAND_ALIASES = {
  LINE: ['LX'],
  CIRCLE: ['CI'],
  ZOOM: ['ZZ']
}

type CadFileFormat = 'dxf' | 'dwg'

type WorkerFileKey = 'dxfParser' | 'dwgParser' | 'mtextRender'

const BYTES_PER_MIB = 1024 * 1024
const DESKTOP_MAX_FILE_BYTES = 128 * BYTES_PER_MIB
const MOBILE_MAX_FILE_BYTES = 64 * BYTES_PER_MIB
const REMOTE_FETCH_TIMEOUT_MS = 45000
const HATCH_WARNING_MESSAGE =
  'Some hatch patterns may be simplified for performance.'

const WORKER_FILE_NAMES: Record<WorkerFileKey, string> = {
  dxfParser: 'dxf-parser-worker.js',
  dwgParser: 'libredwg-parser-worker.js',
  mtextRender: 'mtext-renderer-worker.js'
}

class CadViewerApp {
  private container: HTMLDivElement
  private fileInput: HTMLInputElement
  private centerOpenButton: HTMLButtonElement
  private toolbarOpenButton: HTMLButtonElement
  private toolbarZoomButton: HTMLButtonElement
  private toolbarZoomWindowButton: HTMLButtonElement
  private toolbarBgButton: HTMLButtonElement
  private toolbarPickboxButton: HTMLButtonElement
  private toolbarLineWeightButton: HTMLButtonElement
  private emptyState: HTMLDivElement
  private hatchWarning: HTMLDivElement
  private predefinedButtons: NodeListOf<HTMLButtonElement>
  private isInitialized: boolean = false
  private isLoading: boolean = false
  private activeLoadId: number = 0
  private hasOpenedFile: boolean = false
  private hasLoadedDocument: boolean = false

  constructor() {
    this.container = document.getElementById('cad-container') as HTMLDivElement
    this.fileInput = document.getElementById(
      'fileInputElement'
    ) as HTMLInputElement
    this.centerOpenButton = document.getElementById(
      'centerOpenButton'
    ) as HTMLButtonElement
    this.toolbarOpenButton = document.getElementById(
      'toolbarOpenButton'
    ) as HTMLButtonElement
    this.toolbarZoomButton = document.getElementById(
      'toolbarZoomButton'
    ) as HTMLButtonElement
    this.toolbarZoomWindowButton = document.getElementById(
      'toolbarZoomWindowButton'
    ) as HTMLButtonElement
    this.toolbarBgButton = document.getElementById(
      'toolbarBgButton'
    ) as HTMLButtonElement
    this.toolbarPickboxButton = document.getElementById(
      'toolbarPickboxButton'
    ) as HTMLButtonElement
    this.toolbarLineWeightButton = document.getElementById(
      'toolbarLineWeightButton'
    ) as HTMLButtonElement
    this.emptyState = document.getElementById('emptyState') as HTMLDivElement
    this.hatchWarning = document.getElementById(
      'hatchWarning'
    ) as HTMLDivElement
    this.predefinedButtons = document.querySelectorAll(
      '#predefinedFileList .file-list-item'
    ) as NodeListOf<HTMLButtonElement>

    this.setupHatchWarningHandling()
    this.setupFileHandling()
    this.setupToolbarActions()
    this.setupPredefinedFileActions()
    this.updateEmptyStateVisibility()
    this.updateToolbarButtonsState()
  }

  private initialize() {
    if (!this.isInitialized) {
      try {
        AcApDocManager.createInstance({
          container: this.container,
          autoResize: true,
          baseUrl: 'https://cdn.jsdelivr.net/gh/mlightcad/cad-data@main/',
          commandAliases: EXAMPLE_COMMAND_ALIASES,
          webworkerFileUrls: this.getWorkerFileUrls()
        })

        AcApDocManager.instance.events.documentActivated.addEventListener(
          args => {
            document.title = args.doc.docTitle
          }
        )

        this.isInitialized = true
      } catch (error) {
        log.error('Failed to initialize CAD viewer:', error)
        this.showMessage('Failed to initialize CAD viewer', 'error')
      }
    }

    return this.isInitialized
  }

  private setupFileHandling() {
    this.fileInput.addEventListener('change', event => {
      const file = (event.target as HTMLInputElement).files?.[0]
      if (file) {
        void this.loadLocalFile(file)
      }
      this.fileInput.value = ''
    })

    this.centerOpenButton.addEventListener('click', () => {
      this.fileInput.click()
    })

    this.toolbarOpenButton.addEventListener('click', () => {
      this.fileInput.click()
    })
  }

  private setupToolbarActions() {
    this.toolbarZoomButton.addEventListener('click', () => {
      if (!this.hasLoadedDocument || !this.isInitialized) {
        return
      }
      AcApDocManager.instance.sendStringToExecute('zoom\\nall')
    })

    this.toolbarZoomWindowButton.addEventListener('click', () => {
      if (!this.hasLoadedDocument || !this.isInitialized) {
        return
      }
      AcApDocManager.instance.sendStringToExecute('zoom\\nwindow')
    })

    this.toolbarBgButton.addEventListener('click', () => {
      if (!this.hasLoadedDocument || !this.isInitialized) {
        return
      }
      AcApDocManager.instance.sendStringToExecute('switchbg')
    })

    this.toolbarPickboxButton.addEventListener('click', () => {
      if (!this.hasLoadedDocument || !this.isInitialized) {
        return
      }

      const currentPickbox = AcDbSysVarManager.instance().getVar(
        AcDbSystemVariables.PICKBOX,
        AcApDocManager.instance.curDocument.database
      )
      const initialPickbox =
        currentPickbox == null ? '10' : String(currentPickbox)
      const valueText = window.prompt(
        'Set pick box size (integer):',
        initialPickbox
      )
      if (valueText == null) {
        return
      }

      const pickboxValue = Number.parseInt(valueText, 10)
      if (!Number.isFinite(pickboxValue) || pickboxValue <= 0) {
        this.showMessage('Pickbox size must be a positive integer', 'error')
        return
      }

      AcApDocManager.instance.sendStringToExecute(
        `${AcDbSystemVariables.PICKBOX}\n${pickboxValue}`
      )
      this.showMessage(`Pickbox set to: ${pickboxValue}`, 'success')
    })

    this.toolbarLineWeightButton.addEventListener('click', () => {
      if (!this.hasLoadedDocument || !this.isInitialized) {
        return
      }
      const db = AcApDocManager.instance.curDocument.database
      db.lwdisplay = !db.lwdisplay
      this.updateLineWeightButtonLabel()
    })
  }

  private setupPredefinedFileActions() {
    this.predefinedButtons.forEach(button => {
      button.addEventListener('click', () => {
        const url = button.dataset.fileUrl
        if (!url) {
          return
        }
        this.predefinedButtons.forEach(item => item.classList.remove('active'))
        button.classList.add('active')
        void this.loadPredefinedFile(url)
      })
    })
  }

  private setupHatchWarningHandling() {
    eventBus.on('hatch-render-warning', () => {
      this.showHatchWarning()
    })
  }

  private async loadLocalFile(file: File) {
    const format = this.getSupportedCadFormat(file.name)

    if (!format) {
      this.showMessage('Please select a DXF or DWG file', 'error')
      return
    }

    this.clearMessages()
    this.hideHatchWarning()

    const loadId = this.beginLoad(`Loading ${file.name}...`)
    if (loadId == null) {
      return
    }

    try {
      this.validateFileSize(file.size)
      await this.verifyWorkerAssets(format)

      if (!this.initialize()) {
        throw new Error('CAD viewer initialization failed')
      }

      const fileContent = await this.readFile(file)
      this.validateCadBuffer(file.name, format, fileContent)

      const options: AcApOpenDatabaseOptions = {
        minimumChunkSize: 1000,
        mode: AcEdOpenMode.Write,
        // Override line weight display setting to false so that line weights are not displayed by default
        sysVars: {
          lwdisplay: false
        }
      }

      const success = await AcApDocManager.instance.openDocument(
        file.name,
        fileContent,
        options
      )

      if (success) {
        this.onFileOpened()
        this.predefinedButtons.forEach(item => item.classList.remove('active'))
        this.showMessage(`Successfully loaded: ${file.name}`, 'success')
      } else {
        this.showMessage(
          `Failed to load ${file.name}. The file may be unsupported or corrupt.`,
          'error'
        )
      }
    } catch (error) {
      log.error('Error loading file:', error)
      this.showMessage(this.formatLoadError(error, file.name), 'error')
    } finally {
      this.endLoad(loadId)
    }
  }

  private async loadPredefinedFile(url: string) {
    const fileName = this.getFileNameFromUrl(url)
    const format = this.getSupportedCadFormat(fileName)

    if (!format) {
      this.showMessage(`Unsupported sample file: ${fileName}`, 'error')
      return
    }

    this.clearMessages()
    this.hideHatchWarning()

    const loadId = this.beginLoad(`Loading ${fileName}...`)
    if (loadId == null) {
      return
    }

    try {
      await this.verifyWorkerAssets(format)

      if (!this.initialize()) {
        throw new Error('CAD viewer initialization failed')
      }

      const fileContent = await this.fetchCadFile(url)
      this.validateCadBuffer(fileName, format, fileContent)

      const options: AcApOpenDatabaseOptions = {
        minimumChunkSize: 1000,
        mode: AcEdOpenMode.Write
      }

      const success = await AcApDocManager.instance.openDocument(
        fileName,
        fileContent,
        options
      )

      if (success) {
        this.onFileOpened()
        this.showMessage(`Successfully loaded: ${fileName}`, 'success')
      } else {
        this.showMessage(
          `Failed to load ${fileName}. The file may be unsupported or corrupt.`,
          'error'
        )
      }
    } catch (error) {
      log.error('Error loading predefined file:', error)
      this.showMessage(this.formatLoadError(error, fileName), 'error')
    } finally {
      this.endLoad(loadId)
    }
  }

  private onFileOpened() {
    this.hasOpenedFile = true
    this.hasLoadedDocument = true
    this.updateEmptyStateVisibility()
    this.updateToolbarButtonsState()
  }

  private updateEmptyStateVisibility() {
    this.emptyState.classList.toggle('hidden', this.hasOpenedFile)
  }

  private updateToolbarButtonsState() {
    this.centerOpenButton.disabled = this.isLoading
    this.toolbarOpenButton.disabled = this.isLoading
    this.toolbarOpenButton.textContent = this.isLoading ? 'Loading...' : 'Open'
    this.centerOpenButton.textContent = this.isLoading
      ? 'Loading...'
      : 'Open File'

    this.predefinedButtons.forEach(button => {
      button.disabled = this.isLoading
    })

    this.toolbarZoomButton.disabled = this.isLoading || !this.hasLoadedDocument
    this.toolbarZoomWindowButton.disabled =
      this.isLoading || !this.hasLoadedDocument
    this.toolbarBgButton.disabled = this.isLoading || !this.hasLoadedDocument
    this.toolbarPickboxButton.disabled =
      this.isLoading || !this.hasLoadedDocument
    this.toolbarLineWeightButton.disabled =
      this.isLoading || !this.hasLoadedDocument
    this.updateLineWeightButtonLabel()
  }

  private updateLineWeightButtonLabel() {
    const showLineWeight =
      this.hasLoadedDocument && this.isInitialized
        ? AcApDocManager.instance.curDocument.database.lwdisplay
        : false

    this.toolbarLineWeightButton.textContent = showLineWeight
      ? 'LineWeight: On'
      : 'LineWeight: Off'
  }

  private getFileNameFromUrl(url: string) {
    try {
      const fileUrl = new URL(url, window.location.href)
      const paths = fileUrl.pathname.split('/')
      return decodeURIComponent(paths[paths.length - 1] || url)
    } catch {
      const paths = url.split('?')[0].split('/')
      return paths[paths.length - 1] || url
    }
  }

  private getSupportedCadFormat(fileName: string): CadFileFormat | undefined {
    const extension = fileName.split('.').pop()?.toLowerCase()
    return extension === 'dxf' || extension === 'dwg' ? extension : undefined
  }

  private getWorkerFileUrls(): Record<WorkerFileKey, string> {
    return {
      dxfParser: this.resolveWorkerUrl(WORKER_FILE_NAMES.dxfParser),
      dwgParser: this.resolveWorkerUrl(WORKER_FILE_NAMES.dwgParser),
      mtextRender: this.resolveWorkerUrl(WORKER_FILE_NAMES.mtextRender)
    }
  }

  private resolveWorkerUrl(fileName: string) {
    const baseUrl = import.meta.env.BASE_URL || '/'
    const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
    const appBaseUrl = new URL(normalizedBaseUrl, window.location.href)
    return new URL(`workers/${fileName}`, appBaseUrl).href
  }

  private async verifyWorkerAssets(format: CadFileFormat) {
    const workerUrls = this.getWorkerFileUrls()
    const requiredWorkerKeys: WorkerFileKey[] = [
      'mtextRender',
      format === 'dwg' ? 'dwgParser' : 'dxfParser'
    ]

    await Promise.all(
      requiredWorkerKeys.map(async key => {
        await this.verifyWorkerAsset(key, workerUrls[key])
      })
    )
  }

  private async verifyWorkerAsset(key: WorkerFileKey, url: string) {
    const headResponse = await this.fetchWorkerResponse(url, 'HEAD')
    if (headResponse && this.isJavaScriptWorkerResponse(headResponse)) {
      return
    }

    // Some dev/static hosts route HEAD through an SPA fallback even though GET
    // serves the worker correctly. Confirm with a tiny GET before failing.
    const getResponse = await this.fetchWorkerResponse(url, 'GET')
    if (getResponse) {
      try {
        if (this.isJavaScriptWorkerResponse(getResponse)) {
          return
        }

        throw new Error(
          this.formatWorkerAssetError(key, url, getResponse, headResponse)
        )
      } finally {
        await getResponse.body?.cancel()
      }
    }

    throw new Error(
      `Required CAD worker is unavailable: ${WORKER_FILE_NAMES[key]} (${url})`
    )
  }

  private async fetchWorkerResponse(url: string, method: 'HEAD' | 'GET') {
    try {
      return await fetch(url, {
        method,
        cache: 'no-store',
        headers: method === 'GET' ? { Range: 'bytes=0-0' } : undefined
      })
    } catch {
      return undefined
    }
  }

  private isJavaScriptWorkerResponse(response: Response) {
    return (
      response.ok &&
      this.isJavaScriptResponse(response.headers.get('content-type') ?? '')
    )
  }

  private formatWorkerAssetError(
    key: WorkerFileKey,
    url: string,
    response: Response,
    headResponse?: Response
  ) {
    const contentType = response.headers.get('content-type') || 'unknown MIME'
    const headDetails = headResponse
      ? ` HEAD was ${headResponse.status} ${headResponse.headers.get('content-type') || 'unknown MIME'}.`
      : ''

    return `Required CAD worker ${WORKER_FILE_NAMES[key]} returned ${response.status} ${contentType} from ${url}.${headDetails}`
  }

  private isJavaScriptResponse(contentType: string) {
    return /(?:java|ecma)script/i.test(contentType)
  }

  private beginLoad(message: string) {
    if (this.isLoading) {
      this.showMessage('A CAD file is already loading', 'info')
      return undefined
    }

    this.isLoading = true
    this.activeLoadId += 1
    this.updateToolbarButtonsState()
    this.showMessage(message, 'info')
    return this.activeLoadId
  }

  private endLoad(loadId: number) {
    if (this.activeLoadId !== loadId) {
      return
    }

    this.isLoading = false
    this.updateToolbarButtonsState()
    this.updateEmptyStateVisibility()
  }

  private validateFileSize(fileSize: number) {
    if (fileSize <= 0) {
      throw new Error('The selected file is empty')
    }

    const maxFileBytes = this.getMaxFileBytes()
    if (fileSize > maxFileBytes) {
      throw new Error(
        `The selected file is ${this.formatBytes(
          fileSize
        )}; this browser limit is ${this.formatBytes(maxFileBytes)}`
      )
    }
  }

  private getMaxFileBytes() {
    const navigatorWithMemory = navigator as Navigator & {
      deviceMemory?: number
    }
    const hasCoarsePointer = window.matchMedia('(pointer: coarse)').matches
    const isMemoryConstrained =
      typeof navigatorWithMemory.deviceMemory === 'number' &&
      navigatorWithMemory.deviceMemory <= 4

    return hasCoarsePointer || isMemoryConstrained
      ? MOBILE_MAX_FILE_BYTES
      : DESKTOP_MAX_FILE_BYTES
  }

  private async fetchCadFile(url: string) {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(
      () => controller.abort(),
      REMOTE_FETCH_TIMEOUT_MS
    )

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        cache: 'no-store'
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} while fetching CAD file`)
      }

      const contentLength = response.headers.get('content-length')
      if (contentLength) {
        const byteLength = Number.parseInt(contentLength, 10)
        if (Number.isFinite(byteLength)) {
          this.validateFileSize(byteLength)
        }
      }

      return await this.readResponseBuffer(response)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('Timed out while fetching the CAD file')
      }
      throw error
    } finally {
      window.clearTimeout(timeoutId)
    }
  }

  private async readResponseBuffer(response: Response) {
    const reader = response.body?.getReader()

    if (!reader) {
      const buffer = await response.arrayBuffer()
      this.validateFileSize(buffer.byteLength)
      return buffer
    }

    const chunks: Uint8Array[] = []
    let loadedBytes = 0

    try {
      while (true) {
        const { done, value } = await reader.read()

        if (done) {
          break
        }

        if (!value) {
          continue
        }

        loadedBytes += value.byteLength
        this.validateFileSize(loadedBytes)
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }

    this.validateFileSize(loadedBytes)

    const buffer = new Uint8Array(loadedBytes)
    let position = 0
    chunks.forEach(chunk => {
      buffer.set(chunk, position)
      position += chunk.byteLength
    })

    return buffer.buffer
  }

  private async readFile(file: File): Promise<ArrayBuffer> {
    if (typeof file.arrayBuffer === 'function') {
      const buffer = await file.arrayBuffer()
      this.validateFileSize(buffer.byteLength)
      return buffer
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) {
          this.validateFileSize(reader.result.byteLength)
          resolve(reader.result)
        } else {
          reject(new Error('Browser returned an invalid CAD file buffer'))
        }
      }
      reader.onerror = () => {
        reject(reader.error ?? new Error('Failed to read the CAD file'))
      }
      reader.onabort = () => reject(new Error('CAD file read was cancelled'))
      reader.readAsArrayBuffer(file)
    })
  }

  private validateCadBuffer(
    fileName: string,
    format: CadFileFormat,
    buffer: ArrayBuffer
  ) {
    if (!(buffer instanceof ArrayBuffer)) {
      throw new Error('Browser returned an invalid CAD file buffer')
    }

    if (buffer.byteLength <= 0) {
      throw new Error('The selected file is empty')
    }

    const header = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 4096))
    if (format === 'dwg' && !this.isLikelyDwg(header)) {
      throw new Error(`${fileName} does not look like a valid DWG file`)
    }

    if (format === 'dxf' && !this.isLikelyDxf(header)) {
      throw new Error(`${fileName} does not look like a valid DXF file`)
    }
  }

  private isLikelyDwg(header: Uint8Array) {
    return header.length >= 6 && this.decodeAscii(header.slice(0, 2)) === 'AC'
  }

  private isLikelyDxf(header: Uint8Array) {
    const headerText = this.decodeAscii(header)
      .replace(/^\uFEFF/, '')
      .toUpperCase()

    return (
      headerText.startsWith('AUTOCAD BINARY DXF') ||
      headerText.includes('SECTION')
    )
  }

  private decodeAscii(bytes: Uint8Array) {
    let text = ''
    bytes.forEach(byte => {
      text += String.fromCharCode(byte)
    })
    return text
  }

  private formatLoadError(error: unknown, fileName: string) {
    if (error instanceof Error) {
      return `Could not load ${fileName}: ${error.message}`
    }

    return `Could not load ${fileName}. The file may be unsupported or corrupt.`
  }

  private formatBytes(bytes: number) {
    if (bytes < BYTES_PER_MIB) {
      return `${Math.max(1, Math.round(bytes / 1024))} KiB`
    }

    return `${Math.round(bytes / BYTES_PER_MIB)} MiB`
  }

  private showMessage(
    message: string,
    type: 'success' | 'error' | 'info' = 'info'
  ) {
    this.clearMessages()

    const popup = document.createElement('div')
    popup.className = `popup-message ${type}`
    popup.textContent = message
    popup.style.position = 'fixed'
    popup.style.top = '1rem'
    popup.style.left = '50%'
    popup.style.transform = 'translateX(-50%)'
    popup.style.zIndex = '1000'
    popup.style.padding = '0.75rem 1.25rem'
    popup.style.borderRadius = '8px'
    popup.style.boxShadow = '0 2px 8px rgba(0,0,0,0.25)'
    popup.style.fontSize = '0.95rem'
    popup.style.opacity = '0.98'
    popup.style.transition = 'opacity 0.2s'

    if (type === 'error') {
      popup.style.background = '#fee2e2'
      popup.style.color = '#b91c1c'
      popup.style.border = '1px solid #fecaca'
    } else if (type === 'success') {
      popup.style.background = '#dcfce7'
      popup.style.color = '#166534'
      popup.style.border = '1px solid #bbf7d0'
    } else {
      popup.style.background = '#e5e7eb'
      popup.style.color = '#111827'
      popup.style.border = '1px solid #d1d5db'
    }

    document.body.appendChild(popup)

    const duration = type === 'error' ? 5000 : type === 'info' ? 2400 : 1600

    setTimeout(() => {
      popup.style.opacity = '0'
      setTimeout(() => {
        if (popup.parentNode) {
          popup.parentNode.removeChild(popup)
        }
      }, 200)
    }, duration)
  }

  private clearMessages() {
    document.querySelectorAll('.popup-message').forEach(el => el.remove())
  }

  private showHatchWarning() {
    this.hatchWarning.textContent = HATCH_WARNING_MESSAGE
    this.hatchWarning.classList.remove('hidden')
  }

  private hideHatchWarning() {
    this.hatchWarning.classList.add('hidden')
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new CadViewerApp()
  })
} else {
  new CadViewerApp()
}

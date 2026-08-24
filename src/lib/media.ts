export type Devices = {
  mics: MediaDeviceInfo[]
  cams: MediaDeviceInfo[]
  speakers: MediaDeviceInfo[]
}

export const isSecure = () =>
  window.isSecureContext ||
  location.hostname === 'localhost' ||
  location.hostname === '127.0.0.1'

export async function listDevices(): Promise<Devices> {
  const all = await navigator.mediaDevices.enumerateDevices()
  return {
    mics: all.filter((d) => d.kind === 'audioinput'),
    cams: all.filter((d) => d.kind === 'videoinput'),
    speakers: all.filter((d) => d.kind === 'audiooutput'),
  }
}

export function getMic(deviceId?: string) {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  })
}

export function getCam(deviceId?: string) {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
    },
  })
}

export function getScreen() {
  return navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 30, max: 60 } },
    audio: true, // captura o som da aba/tela quando o SO permite
  })
}

export function stopStream(s: MediaStream | null) {
  s?.getTracks().forEach((t) => t.stop())
}

/** Erros de permissão em português, porque o nome nativo não diz nada. */
export function mediaErrorMessage(err: unknown): string {
  const name = (err as DOMException)?.name || ''
  switch (name) {
    case 'NotAllowedError':
      return 'Permissão negada. Libere o acesso no cadeado da barra de endereço.'
    case 'NotFoundError':
      return 'Nenhum dispositivo encontrado.'
    case 'NotReadableError':
      return 'O dispositivo está em uso por outro programa.'
    case 'OverconstrainedError':
      return 'O dispositivo escolhido não está mais disponível.'
    case 'AbortError':
      return 'A captura foi cancelada.'
    default:
      return (err as Error)?.message || 'Falha ao acessar o dispositivo.'
  }
}

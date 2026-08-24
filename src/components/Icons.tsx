type P = { size?: number }

const svg = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
})

export const MicOn = ({ size = 20 }: P) => (
  <svg {...svg(size)}>
    <rect x="9" y="2" width="6" height="11" rx="3" />
    <path d="M5 10a7 7 0 0 0 14 0" />
    <path d="M12 17v4" />
  </svg>
)

export const MicOff = ({ size = 20 }: P) => (
  <svg {...svg(size)}>
    <path d="M15 5a3 3 0 0 0-6 0v4" />
    <path d="M9 11v-.5" />
    <path d="M5 10a7 7 0 0 0 10.5 6.06" />
    <path d="M19 10a7 7 0 0 1-.6 2.8" />
    <path d="M12 17v4" />
    <path d="M3 3l18 18" />
  </svg>
)

export const CamOn = ({ size = 20 }: P) => (
  <svg {...svg(size)}>
    <rect x="2" y="6" width="13" height="12" rx="2.5" />
    <path d="M15 11l6-3.5v9L15 13z" />
  </svg>
)

export const CamOff = ({ size = 20 }: P) => (
  <svg {...svg(size)}>
    <path d="M9 6h3.5A2.5 2.5 0 0 1 15 8.5V11" />
    <path d="M15 11l6-3.5v9l-3-1.75" />
    <path d="M2 8.5A2.5 2.5 0 0 1 4.5 6" />
    <path d="M2 9v6.5A2.5 2.5 0 0 0 4.5 18h8" />
    <path d="M3 3l18 18" />
  </svg>
)

export const Screen = ({ size = 20 }: P) => (
  <svg {...svg(size)}>
    <rect x="2.5" y="4" width="19" height="12.5" rx="2" />
    <path d="M8.5 20.5h7" />
    <path d="M12 16.5v4" />
    <path d="M12 12.5V7.5M9.5 10 12 7.5l2.5 2.5" />
  </svg>
)

export const ScreenOff = ({ size = 20 }: P) => (
  <svg {...svg(size)}>
    <rect x="2.5" y="4" width="19" height="12.5" rx="2" />
    <path d="M8.5 20.5h7" />
    <path d="M12 16.5v4" />
    <path d="M9 10.5h6" />
  </svg>
)

export const Leave = ({ size = 20 }: P) => (
  <svg {...svg(size)}>
    <path d="M3.5 13.5c4.7-4.7 12.3-4.7 17 0l.3-2.6c.1-1-.4-1.9-1.3-2.3a17.2 17.2 0 0 0-15 0c-.9.4-1.4 1.3-1.3 2.3z" />
    <path d="M8.6 12.2 7.4 15a1.6 1.6 0 0 1-1.9 1l-1.6-.4" />
    <path d="M15.4 12.2l1.2 2.8c.3.8 1.1 1.2 1.9 1l1.6-.4" />
  </svg>
)

export const People = ({ size = 20 }: P) => (
  <svg {...svg(size)}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 19a6 6 0 0 1 12 0" />
    <path d="M16 5.5a3.2 3.2 0 0 1 0 6" />
    <path d="M17.5 14.2A6 6 0 0 1 21 19" />
  </svg>
)

export const Chat = ({ size = 20 }: P) => (
  <svg {...svg(size)}>
    <path d="M21 12a8 8 0 0 1-8 8H4l2-3.2A8 8 0 1 1 21 12z" />
  </svg>
)

export const Pin = ({ size = 16 }: P) => (
  <svg {...svg(size)}>
    <path d="M9 3h6l-1 6 3 3H7l3-3z" />
    <path d="M12 12v9" />
  </svg>
)

export const Speaker = ({ size = 16 }: P) => (
  <svg {...svg(size)}>
    <path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z" />
    <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5" />
    <path d="M18 7a7 7 0 0 1 0 10" />
  </svg>
)

export const SpeakerOff = ({ size = 16 }: P) => (
  <svg {...svg(size)}>
    <path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z" />
    <path d="M16 10l5 4M21 10l-5 4" />
  </svg>
)

export const Settings = ({ size = 18 }: P) => (
  <svg {...svg(size)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.5 15a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10.4 4.5a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.7 1.1z" />
  </svg>
)

export const Hash = ({ size = 18 }: P) => (
  <svg {...svg(size)}>
    <path d="M5 9h14M4.5 15h14M10.5 3.5 8.5 20.5M15.5 3.5l-2 17" />
  </svg>
)

export const VoiceChannel = ({ size = 18 }: P) => (
  <svg {...svg(size)}>
    <path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z" />
    <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5" />
    <path d="M18 7a7 7 0 0 1 0 10" />
  </svg>
)

export const Disconnect = ({ size = 18 }: P) => (
  <svg {...svg(size)}>
    <path d="M3.5 13.5c4.7-4.7 12.3-4.7 17 0l.3-2.6c.1-1-.4-1.9-1.3-2.3a17.2 17.2 0 0 0-15 0c-.9.4-1.4 1.3-1.3 2.3z" />
    <path d="M8.6 12.2 7.4 15a1.6 1.6 0 0 1-1.9 1l-1.6-.4" />
    <path d="M15.4 12.2l1.2 2.8c.3.8 1.1 1.2 1.9 1l1.6-.4" />
    <path d="M3 21 21 3" />
  </svg>
)

export const Expand = ({ size = 16 }: P) => (
  <svg {...svg(size)}>
    <path d="M9 3.5H4.5V8M15 3.5h4.5V8M9 20.5H4.5V16M15 20.5h4.5V16" />
  </svg>
)

export const Collapse = ({ size = 16 }: P) => (
  <svg {...svg(size)}>
    <path d="M4.5 9H9V4.5M19.5 9H15V4.5M4.5 15H9v4.5M19.5 15H15v4.5" />
  </svg>
)

export const Chevron = ({ size = 14 }: P) => (
  <svg {...svg(size)}>
    <path d="m9 6 6 6-6 6" />
  </svg>
)

export const Reply = ({ size = 16 }: P) => (
  <svg {...svg(size)}>
    <path d="M9 7 4 12l5 5" />
    <path d="M4 12h9a7 7 0 0 1 7 7v1" />
  </svg>
)

export const Attach = ({ size = 18 }: P) => (
  <svg {...svg(size)}>
    <path d="M20 11.5 12.4 19a4.5 4.5 0 0 1-6.4-6.4l7.6-7.6a3 3 0 1 1 4.3 4.3l-7.6 7.6a1.5 1.5 0 0 1-2.2-2.2l7-7" />
  </svg>
)

export const Close = ({ size = 15 }: P) => (
  <svg {...svg(size)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
)

export const Send = ({ size = 18 }: P) => (
  <svg {...svg(size)}>
    <path d="M4 12 20.5 4l-6 16.5-3.2-6.8z" />
    <path d="M11.3 13.7 20.5 4" />
  </svg>
)

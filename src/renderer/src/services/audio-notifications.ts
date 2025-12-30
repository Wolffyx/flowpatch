/**
 * Audio Notifications Service
 *
 * Provides audio feedback for worker events like task completion,
 * errors, and approval requests.
 */

export type NotificationSoundType = 'complete' | 'error' | 'approval'

interface NotificationsConfig {
  audioEnabled: boolean
  soundOnComplete: boolean
  soundOnError: boolean
  soundOnApproval: boolean
}

// Audio context for playing sounds
let audioContext: AudioContext | null = null

// Sound data cache
const soundCache: Map<NotificationSoundType, AudioBuffer> = new Map()

// Get or create audio context
function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext()
  }
  return audioContext
}

// Generate a simple tone programmatically (no external files needed)
function generateTone(
  frequency: number,
  duration: number,
  type: OscillatorType = 'sine',
  volume: number = 0.3
): AudioBuffer {
  const ctx = getAudioContext()
  const sampleRate = ctx.sampleRate
  const length = sampleRate * duration
  const buffer = ctx.createBuffer(1, length, sampleRate)
  const data = buffer.getChannelData(0)

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate
    // Apply envelope (fade in/out)
    const envelope = Math.min(1, t * 20) * Math.min(1, (duration - t) * 20)
    let sample = 0

    switch (type) {
      case 'sine':
        sample = Math.sin(2 * Math.PI * frequency * t)
        break
      case 'square':
        sample = Math.sign(Math.sin(2 * Math.PI * frequency * t))
        break
      case 'triangle':
        sample = Math.asin(Math.sin(2 * Math.PI * frequency * t)) * (2 / Math.PI)
        break
      case 'sawtooth':
        sample = 2 * ((frequency * t) % 1) - 1
        break
    }

    data[i] = sample * envelope * volume
  }

  return buffer
}

// Generate a chord (multiple frequencies)
function generateChord(
  frequencies: number[],
  duration: number,
  volume: number = 0.2
): AudioBuffer {
  const ctx = getAudioContext()
  const sampleRate = ctx.sampleRate
  const length = sampleRate * duration
  const buffer = ctx.createBuffer(1, length, sampleRate)
  const data = buffer.getChannelData(0)

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate
    // Apply envelope (fade in/out)
    const envelope = Math.min(1, t * 15) * Math.min(1, (duration - t) * 10)
    let sample = 0

    for (const freq of frequencies) {
      sample += Math.sin(2 * Math.PI * freq * t)
    }

    data[i] = (sample / frequencies.length) * envelope * volume
  }

  return buffer
}

// Generate notification sounds
function generateSounds(): void {
  // Success sound: Rising chord (C-E-G)
  const successBuffer = generateChord([523.25, 659.25, 783.99], 0.4, 0.25)
  soundCache.set('complete', successBuffer)

  // Error sound: Descending tone
  const ctx = getAudioContext()
  const errorLength = ctx.sampleRate * 0.3
  const errorBuffer = ctx.createBuffer(1, errorLength, ctx.sampleRate)
  const errorData = errorBuffer.getChannelData(0)

  for (let i = 0; i < errorLength; i++) {
    const t = i / ctx.sampleRate
    const envelope = Math.min(1, t * 20) * Math.min(1, (0.3 - t) * 15)
    // Descending frequency from 440 to 220 Hz
    const freq = 440 - (220 * t) / 0.3
    errorData[i] = Math.sin(2 * Math.PI * freq * t) * envelope * 0.3
  }
  soundCache.set('error', errorBuffer)

  // Approval sound: Two-tone alert (like a doorbell)
  const approvalLength = ctx.sampleRate * 0.5
  const approvalBuffer = ctx.createBuffer(1, approvalLength, ctx.sampleRate)
  const approvalData = approvalBuffer.getChannelData(0)

  for (let i = 0; i < approvalLength; i++) {
    const t = i / ctx.sampleRate
    let sample = 0

    if (t < 0.2) {
      // First tone: higher pitch
      const envelope = Math.min(1, t * 30) * Math.min(1, (0.2 - t) * 10)
      sample = Math.sin(2 * Math.PI * 880 * t) * envelope
    } else if (t >= 0.25 && t < 0.5) {
      // Second tone: lower pitch
      const t2 = t - 0.25
      const envelope = Math.min(1, t2 * 30) * Math.min(1, (0.25 - t2) * 10)
      sample = Math.sin(2 * Math.PI * 659.25 * t2) * envelope
    }

    approvalData[i] = sample * 0.25
  }
  soundCache.set('approval', approvalBuffer)
}

// Play a sound buffer
async function playBuffer(buffer: AudioBuffer): Promise<void> {
  const ctx = getAudioContext()

  // Resume context if suspended (browser autoplay policy)
  if (ctx.state === 'suspended') {
    await ctx.resume()
  }

  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.connect(ctx.destination)
  source.start()

  return new Promise((resolve) => {
    source.onended = () => resolve()
  })
}

/**
 * Play a notification sound
 * @param type - Type of notification sound to play
 * @param config - Notification configuration
 */
export async function playNotificationSound(
  type: NotificationSoundType,
  config?: Partial<NotificationsConfig>
): Promise<void> {
  // Default config with audio enabled
  const effectiveConfig: NotificationsConfig = {
    audioEnabled: config?.audioEnabled ?? true,
    soundOnComplete: config?.soundOnComplete ?? true,
    soundOnError: config?.soundOnError ?? true,
    soundOnApproval: config?.soundOnApproval ?? true
  }

  // Check if audio is enabled globally
  if (!effectiveConfig.audioEnabled) {
    return
  }

  // Check if this specific sound type is enabled
  switch (type) {
    case 'complete':
      if (!effectiveConfig.soundOnComplete) return
      break
    case 'error':
      if (!effectiveConfig.soundOnError) return
      break
    case 'approval':
      if (!effectiveConfig.soundOnApproval) return
      break
  }

  // Generate sounds if not cached
  if (soundCache.size === 0) {
    generateSounds()
  }

  // Get the sound buffer
  const buffer = soundCache.get(type)
  if (!buffer) {
    console.warn(`No sound buffer found for type: ${type}`)
    return
  }

  try {
    await playBuffer(buffer)
  } catch (err) {
    console.warn('Failed to play notification sound:', err)
  }
}

/**
 * Pre-initialize the audio system (call on user interaction to bypass autoplay restrictions)
 */
export function initAudio(): void {
  try {
    getAudioContext()
    generateSounds()
  } catch (err) {
    console.warn('Failed to initialize audio:', err)
  }
}

/**
 * Test all notification sounds
 */
export async function testAllSounds(): Promise<void> {
  const types: NotificationSoundType[] = ['complete', 'error', 'approval']
  for (const type of types) {
    await playNotificationSound(type, { audioEnabled: true })
    // Wait between sounds
    await new Promise((resolve) => setTimeout(resolve, 600))
  }
}

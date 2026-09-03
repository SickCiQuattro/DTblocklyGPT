/**
 * A picture for every gesture the operator can be asked to make.
 *
 * The panel named its gestures and never showed them: "Peace sign", "OK sign",
 * "Fist" as bare English words, to first-time study participants reading a
 * second language. The hand shape is the whole instruction — MediaPipe rejects
 * a wrong guess — so a participant who guessed wrong produced a recognition
 * failure that the study then recorded as a recognition failure. It was a
 * labelling failure.
 *
 * Four come straight from lucide, which happens to ship the exact gesture:
 * ThumbsUp, ThumbsDown, Hand (open palm) and HandFist. Note what is NOT used:
 * lucide's `HandMetal` is the horns 🤘, and reaching for it as "close enough"
 * to a peace sign would teach the operator a hand shape the recognizer will
 * reject — worse than no icon.
 *
 * Peace and OK do not exist in the set, so they are drawn here, in lucide's own
 * construction: 24×24 viewBox, `fill: none`, `stroke: currentColor`, width 2,
 * round caps and joins, fingers built as capsules from a vertical pair and an
 * arc pair exactly the way `hand.mjs` and `hand-metal.mjs` build theirs. The
 * palm outline is lucide's own `hand` palm, reused rather than reinvented, so
 * the two authored icons sit in a row with the four real ones without reading
 * as guests.
 *
 * `currentColor` throughout: these are tinted by whatever renders them (muted
 * in a legend, success green when the gesture matches), and a hard-coded fill
 * would break that at the one moment it matters.
 */
import { Hand, HandFist, ThumbsDown, ThumbsUp } from 'lucide-react'
import type { LucideProps } from 'lucide-react'

// lucide's own palm + thumb + wrist, shared by both authored icons.
const PALM =
  'M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15'

const svgProps = (props: LucideProps) => ({
  xmlns: 'http://www.w3.org/2000/svg',
  width: props.size ?? 24,
  height: props.size ?? 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: props.color ?? 'currentColor',
  strokeWidth: props.strokeWidth ?? 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...(props.style ? { style: props.style } : {}),
})

/** Index and middle extended into a V, ring and little folded. */
export const PeaceSignIcon = (props: LucideProps) => (
  <svg {...svgProps(props)} aria-hidden>
    {/* The splay is a rotation about each finger's own base rather than baked
        into the coordinates: a V that is only two parallel fingers reads as
        "two", not as this gesture. */}
    <path
      d="M10 12V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v9"
      transform="rotate(-20 8 14)"
    />
    <path
      d="M14 12V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"
      transform="rotate(18 12 14)"
    />
    <path d="M18 12.5V11a2 2 0 1 0-4 0v1.5" />
    <path d={PALM} />
  </svg>
)

/** Thumb and index closed into a ring, the other three fingers up. */
export const OkSignIcon = (props: LucideProps) => (
  <svg {...svgProps(props)} aria-hidden>
    {/* THREE fingers, not two, and a ring big enough to be the subject.
        An earlier version drew a small ring beside two fingers, which read as
        a peace sign standing next to a circle rather than as one hand. The
        ring is what identifies this gesture, so it gets the space; the fingers
        step down in height the way real ones do, which is what makes a row of
        capsules read as a hand at 13px. */}
    <path d="M11.6 12a4.3 4.3 0 1 1-8.6 0a4.3 4.3 0 1 1 8.6 0" />
    <path d="M12.6 12.5V5a1.8 1.8 0 0 1 3.6 0v7.5" />
    <path d="M16.2 12.5V6.2a1.8 1.8 0 0 1 3.6 0v6.3" />
    {/* The thumb reaches the ring from OUTSIDE, up the left edge, and stops
        where it meets the circle.

        Two earlier attempts got this wrong in opposite directions. Sitting the
        ring high left a loose thumb stub below it with nothing to touch — the
        ring and the hand read as two separate objects. Lowering the ring but
        keeping a straight run to its centre drew a line slashing right through
        the circle. In a real OK sign the thumb and index TIP form the ring, so
        the outline has to arrive tangentially and end there. */}
    <path d="M19.8 11.2a1.8 1.8 0 0 1 3.6 0V14a8 8 0 0 1-8 8h-3a7 7 0 0 1-4.6-1.8C5.8 18.4 4 16.5 3.35 13.9" />
  </svg>
)

/**
 * Gesture code → icon. Keys are the codes in `recognitionRegistry.ts`, which
 * is the vocabulary's single source of truth; a gesture added there without an
 * entry here renders no icon rather than a wrong one.
 */
export type GestureIcon = React.ComponentType<LucideProps>

export const GESTURE_ICONS: Record<string, GestureIcon> = {
  THUMBS_UP: ThumbsUp,
  THUMBS_DOWN: ThumbsDown,
  OPEN_HAND: Hand,
  FIST: HandFist,
  PEACE: PeaceSignIcon,
  OK: OkSignIcon,
}

export const gestureIcon = (code?: string | null) =>
  code ? GESTURE_ICONS[code.toUpperCase()] : undefined

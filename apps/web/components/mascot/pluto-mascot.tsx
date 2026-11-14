import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * Pluto mascot: a light-blue planet with a sunny ring and a check badge.
 * Each mood is a different face plus a small effect (thought dots, sweat drop,
 * sparkles, "zzz", question mark). Animations are CSS-only and turn off under
 * `prefers-reduced-motion`.
 */
export type MascotMood =
  | "happy" // default / welcome
  | "thinking" // request sent, waiting
  | "working" // still waiting: the agent is running tools
  | "excited" // reply finished
  | "asking" // reply ends with a question for the student
  | "sleeping" // idle
  | "worried"; // error

const NAVY = "#1B2A5A";
const RING = "#FFC83D";
const CRATER = "#3E9BE0";

const STYLE = `
.pm-bob{animation:pm-bob 3.2s ease-in-out infinite;transform-origin:center}
.pm-dot{animation:pm-dot 1.2s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
.pm-d2{animation-delay:.2s}.pm-d3{animation-delay:.4s}
.pm-sweat{animation:pm-sweat 1.4s ease-in infinite}
.pm-tw{animation:pm-tw 1.6s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
.pm-t2{animation-delay:.4s}.pm-t3{animation-delay:.8s}.pm-t4{animation-delay:1.2s}
.pm-z{animation:pm-z 2.4s ease-in-out infinite}
.pm-z2{animation-delay:.6s}.pm-z3{animation-delay:1.2s}
.pm-q{animation:pm-q 1.8s ease-in-out infinite;transform-box:fill-box;transform-origin:bottom center}
.pm-shake{animation:pm-shake 2.4s ease-in-out infinite;transform-origin:center}
@keyframes pm-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
@keyframes pm-dot{0%,100%{opacity:.35;transform:scale(.8)}50%{opacity:1;transform:scale(1.1)}}
@keyframes pm-sweat{0%{opacity:0;transform:translateY(-3px)}30%{opacity:1}100%{opacity:0;transform:translateY(6px)}}
@keyframes pm-tw{0%,100%{opacity:.2;transform:scale(.6) rotate(0)}50%{opacity:1;transform:scale(1.15) rotate(20deg)}}
@keyframes pm-z{0%{opacity:0;transform:translate(0,4px)}40%{opacity:1}100%{opacity:0;transform:translate(4px,-6px)}}
@keyframes pm-q{0%,100%{transform:rotate(-8deg)}50%{transform:rotate(8deg)}}
@keyframes pm-shake{0%,90%,100%{transform:rotate(0)}93%{transform:rotate(-3deg)}96%{transform:rotate(3deg)}}
@media (prefers-reduced-motion:reduce){.pm-bob,.pm-dot,.pm-sweat,.pm-tw,.pm-z,.pm-q,.pm-shake{animation:none}}
`;

function Eye({ cx, cy, r = 7.5, look = [1.5, 1.5] }: { cx: number; cy: number; r?: number; look?: [number, number] }) {
  const [dx, dy] = look;
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="#fff" />
      <circle cx={cx + dx} cy={cy + dy} r={r * 0.6} fill={NAVY} />
      <circle cx={cx + dx + r * 0.28} cy={cy + dy - r * 0.28} r={r * 0.2} fill="#fff" />
    </g>
  );
}

const stroke = { stroke: NAVY, strokeWidth: 3.5, strokeLinecap: "round", strokeLinejoin: "round", fill: "none" } as const;

function Face({ mood }: { mood: MascotMood }) {
  switch (mood) {
    case "thinking":
      return (
        <g>
          <Eye cx={50} cy={58} r={6.5} look={[1.8, -1.8]} />
          <Eye cx={72} cy={58} r={6.5} look={[1.8, -1.8]} />
          <path d="M55 74 q3 -2.5 6 0 q3 2.5 6 0" {...stroke} strokeWidth={3} />
          <circle className="pm-dot" cx={98} cy={34} r={2.6} fill={RING} />
          <circle className="pm-dot pm-d2" cx={104.5} cy={24.5} r={3.4} fill={RING} />
          <circle className="pm-dot pm-d3" cx={113} cy={13} r={4.4} fill={RING} />
        </g>
      );
    case "working":
      return (
        <g>
          <path d="M42 47 L55 51.5" {...stroke} />
          <path d="M80 47 L67 51.5" {...stroke} />
          <Eye cx={50} cy={59} r={6.5} look={[0.8, 0.8]} />
          <Eye cx={72} cy={59} r={6.5} look={[-0.8, 0.8]} />
          <path d="M54 75 q3.5 -3 7 0 q3.5 3 7 0" {...stroke} strokeWidth={3} />
          <path className="pm-sweat" d="M95 28 q5.5 7.5 0 11 q-5.5 -3.5 0 -11z" fill="#9FDBFF" />
        </g>
      );
    case "excited":
      return (
        <g>
          <path d="M43 60 Q50 51 57 60" {...stroke} strokeWidth={4} />
          <path d="M65 60 Q72 51 79 60" {...stroke} strokeWidth={4} />
          <path d="M53 67 h16 q0 11 -8 11 q-8 0 -8 -11z" fill={NAVY} />
          <path d="M56.5 75.5 q4.5 -3.5 9 0 q-4.5 2.5 -9 0z" fill="#FF7A9A" />
          <rect className="pm-tw" x={20} y={22} width={6} height={6} rx={1} transform="rotate(45 23 25)" fill="#FF8FA3" />
          <circle className="pm-tw pm-t2" cx={106} cy={22} r={3} fill={RING} />
          <rect className="pm-tw pm-t3" x={12} y={66} width={5} height={5} rx={1} transform="rotate(45 14.5 68.5)" fill="#9FDBFF" />
          <rect className="pm-tw pm-t4" x={108} y={48} width={5} height={5} rx={1} transform="rotate(45 110.5 50.5)" fill="#FF8FA3" />
        </g>
      );
    case "asking":
      return (
        <g>
          <path d="M43 47 Q50 41.5 56 45" {...stroke} strokeWidth={3} />
          <Eye cx={50} cy={58} look={[1.6, -1.2]} />
          <Eye cx={72} cy={58} r={6.5} look={[1.6, -1.2]} />
          <circle cx={61} cy={74} r={3.4} fill={NAVY} />
          <text
            className="pm-q"
            x={96}
            y={34}
            fontSize={26}
            fontWeight={800}
            fontFamily="ui-rounded, system-ui, sans-serif"
            fill={RING}
          >
            ?
          </text>
        </g>
      );
    case "sleeping":
      return (
        <g>
          <path d="M43 58 Q50 64 57 58" {...stroke} />
          <path d="M65 58 Q72 64 79 58" {...stroke} />
          <path d="M57.5 73 q3.5 2.5 7 0" {...stroke} strokeWidth={3} />
          <g fill={RING} fontWeight={800} fontFamily="ui-rounded, system-ui, sans-serif">
            <text className="pm-z" x={96} y={34} fontSize={13}>z</text>
            <text className="pm-z pm-z2" x={105} y={22} fontSize={10}>z</text>
            <text className="pm-z pm-z3" x={112} y={12} fontSize={8}>z</text>
          </g>
        </g>
      );
    case "worried":
      return (
        <g>
          <path d="M43 50 L55 45.5" {...stroke} strokeWidth={3} />
          <path d="M79 50 L67 45.5" {...stroke} strokeWidth={3} />
          <Eye cx={50} cy={59} r={6.5} look={[0, 1.8]} />
          <Eye cx={72} cy={59} r={6.5} look={[0, 1.8]} />
          <path d="M54 76 Q61 69.5 68 76" {...stroke} strokeWidth={3} />
        </g>
      );
    case "happy":
    default:
      return (
        <g>
          <Eye cx={49} cy={57} />
          <Eye cx={73} cy={57} />
          <path d="M52 71 Q61 79 70 71" {...stroke} strokeWidth={4} />
        </g>
      );
  }
}

export function PlutoMascot({
  mood = "happy",
  size = 64,
  animated = true,
  label,
  className,
}: {
  mood?: MascotMood;
  /** Rendered width/height in px (or any CSS length). */
  size?: number | string;
  /** Gentle floating bob and mood effects. */
  animated?: boolean;
  /** Accessible name. Omit when the mascot is decorative. */
  label?: string;
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const body = `pm-body-${id}`;
  const front = `pm-front-${id}`;
  return (
    <svg
      viewBox="0 0 128 128"
      width={size}
      height={size}
      className={cn("shrink-0 overflow-visible", className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-mood={mood}
    >
      <style>{STYLE}</style>
      <defs>
        <radialGradient id={body} cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#8DD5FB" />
          <stop offset="70%" stopColor="#6CC0F4" />
          <stop offset="100%" stopColor="#58B2EC" />
        </radialGradient>
        <clipPath id={front} clipPathUnits="userSpaceOnUse">
          <rect x={0} y={76} width={128} height={52} />
        </clipPath>
      </defs>
      <g className={cn(animated && "pm-bob", animated && mood === "worried" && "pm-shake")}>
        <g transform="rotate(-16 62 76)">
          <ellipse cx={62} cy={76} rx={56} ry={14} fill="none" stroke={RING} strokeWidth={6} />
        </g>
        <circle cx={61} cy={62} r={36} fill={`url(#${body})`} />
        <path d="M37 47 Q42 33 57 29" stroke="#fff" strokeOpacity={0.75} strokeWidth={4.5} strokeLinecap="round" fill="none" />
        <circle cx={36} cy={70} r={4} fill={CRATER} opacity={0.75} />
        <circle cx={50} cy={89} r={3} fill={CRATER} opacity={0.75} />
        <g className={animated ? undefined : "[&_*]:animate-none!"}>
          <Face mood={mood} />
        </g>
        <g transform="rotate(-16 62 76)">
          <ellipse
            cx={62}
            cy={76}
            rx={56}
            ry={14}
            fill="none"
            stroke={RING}
            strokeWidth={6}
            clipPath={`url(#${front})`}
          />
          <circle cx={104} cy={84.5} r={8} fill={RING} />
          <path d="M100 84.5 l3 3 l5.5 -6" {...stroke} strokeWidth={2.6} />
        </g>
      </g>
    </svg>
  );
}

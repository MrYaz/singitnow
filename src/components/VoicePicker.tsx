/** Pick one or more voices. The order you tap them in is your preference. */
export function VoicePicker({ all, value, onChange, cols = 2 }: { all: string[]; value: string[]; onChange: (v: string[]) => void; cols?: 2 | 3 }) {
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])
  return (
    <div className="space-y-2">
      <div className={`grid gap-2 ${cols === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {all.map((v) => {
          const i = value.indexOf(v)
          return (
            <button key={v} aria-pressed={i >= 0} className={`${i >= 0 ? 'btn-primary' : 'btn-ghost'} relative px-2 py-2 text-sm`} onClick={() => toggle(v)}>
              {i >= 0 && <span className="mr-1">✓</span>}
              {v}
              {i >= 0 && value.length > 1 && (
                <span className="absolute -top-2 -right-1 grid h-5 w-5 place-items-center rounded-full bg-warm-500 text-[11px] font-black text-white">{i + 1}</span>
              )}
            </button>
          )
        })}
      </div>
      <p className="text-xs text-gray-500">
        Välj flera om låtarna delar stämmorna olika, till exempel Sopran och Sopran 1. Varje låt använder den första av dina stämmor som finns i låten.
      </p>
    </div>
  )
}

export const voiceLabel = (voices: string[]) => (voices.length ? voices.join(' + ') : 'Välj stämma')

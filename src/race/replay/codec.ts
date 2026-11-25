/**
 * Encodage compact d'une liste d'entrées : chaque suite d'entrées identiques
 * devient (nombre de répétitions, entrée). Une tentative de 40 s tient en quelques centaines d'octets.
 */
export function encodeInputs(inputs: ArrayLike<number>): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < inputs.length) {
    const v = inputs[i]! & 0xff;
    let run = 1;
    while (i + run < inputs.length && (inputs[i + run]! & 0xff) === v && run < 255) run++;
    out.push(run, v);
    i += run;
  }
  return Uint8Array.from(out);
}

export function decodeInputs(data: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < data.length; i += 2) {
    const run = data[i]!;
    const v = data[i + 1]!;
    for (let k = 0; k < run; k++) out.push(v);
  }
  return out;
}

export function toBase64(data: Uint8Array): string {
  let s = "";
  for (const b of data) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

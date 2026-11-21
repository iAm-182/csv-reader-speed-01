// Fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader, MIT).
//
// Original implementation, written from the reference's stated policy:
// one left-to-right pass, BOM dropped, records end at LF/CRLF, empty lines
// are no record, lone CR outside quotes is dropped (stray_cr), a field that
// opens with a quote runs to the next non-doubled quote ("" is one quote,
// CRLF/lone CR inside quotes read as LF), junk after a closing quote is
// appended as-is (quote_junk), a quote that never closes is a literal and
// the text after it is re-read as unquoted (unterminated_quote), quotes
// inside unquoted fields are literal, fields stay strings, records are
// padded (short_row) or cut (long_row) to the first record's width, and
// errors are {code, line, row} in encounter order, line being the line the
// record starts on.
//
// Speed comes from never building a field a character at a time: fields are
// slices of the input, found with native regex scans for the next delimiter,
// and a field is only joined from pieces when it actually holds a stray CR,
// a doubled quote, or a line break inside quotes (the rare cases). The
// common field — plain text up to the next comma or line break — is one
// slice and one scan.

const COMMA = 0;
const LINE = 1;
const END = 2;

// Next delimiter of an unquoted field: comma, CR or LF.
const DELIM = /[,\r\n]/g;
// Next interesting character inside a quoted field: quote, CR or LF.
const QDELIM = /["\r\n]/g;

/** csv-reader 1.0.0's answer for one case's input: {columns, rows, errors}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and its index in rows
  // (null for the header). Every error of a record carries these.
  let recordLine = 1;
  let recordRow = null;

  // Reads an unquoted field starting at pos, with `prefix` already its
  // first characters ('' normally, '"' after an unterminated quote, or a
  // quoted field's value before its junk). Returns {v, e, added}: the
  // field, how it ended, and how many characters were kept after prefix.
  function unquoted(prefix) {
    let start = pos;
    let parts = prefix === '' ? null : [prefix];
    let added = 0;
    while (true) {
      DELIM.lastIndex = pos;
      const m = DELIM.exec(text);
      if (m === null) {
        const tail = text.slice(start);
        added += tail.length;
        pos = n;
        return { v: parts === null ? tail : parts.join('') + tail, e: END, added };
      }
      const i = m.index;
      const c = text.charCodeAt(i);
      if (c === 44) {
        // ',' — the record goes on.
        const seg = text.slice(start, i);
        added += seg.length;
        pos = i + 1;
        return { v: parts === null ? seg : parts.join('') + seg, e: COMMA, added };
      }
      if (c === 10) {
        // LF — the record ends.
        const seg = text.slice(start, i);
        added += seg.length;
        pos = i + 1;
        line += 1;
        return { v: parts === null ? seg : parts.join('') + seg, e: LINE, added };
      }
      if (text.charCodeAt(i + 1) === 10) {
        // CRLF — the record ends.
        const seg = text.slice(start, i);
        added += seg.length;
        pos = i + 2;
        line += 1;
        return { v: parts === null ? seg : parts.join('') + seg, e: LINE, added };
      }
      // A lone CR outside quotes is dropped (stray_cr); the field goes on.
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      if (parts === null) parts = [];
      parts.push(text.slice(start, i));
      added += i - start;
      pos = i + 1;
      start = pos;
    }
  }

  while (true) {
    // Lines left with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    let fields;
    let ended;
    let lastQuoted = false;

    // Fast path: a record with no quote before its line break holds no
    // quoted field, no embedded line break and (checked below) no stray
    // CR, so its fields are one native split on commas.
    const lf = text.indexOf('\n', pos);
    const q = text.indexOf('"', pos);
    if (lf !== -1 && (q === -1 || q > lf)) {
      let seg = text.slice(pos, lf);
      const cr = seg.indexOf('\r');
      if (cr === -1 || cr === seg.length - 1) {
        if (cr !== -1) seg = seg.slice(0, -1); // CRLF ends the record.
        fields = seg.split(',');
        line += 1;
        pos = lf + 1;
        ended = LINE;
      }
    } else if (lf === -1 && q === -1) {
      const seg = text.slice(pos);
      if (seg.indexOf('\r') === -1) {
        fields = seg.split(',');
        pos = n;
        ended = END;
      }
    }
    if (fields === undefined) {
      fields = [];
      do {
      if (text.charCodeAt(pos) === 34) {
        // A field that opens with a quote.
        lastQuoted = true;
        const open = pos;
        const openLine = line;
        pos += 1;
        let segStart = pos;
        let parts = null;
        let value;
        let closed = false;
        while (!closed) {
          QDELIM.lastIndex = pos;
          const m = QDELIM.exec(text);
          if (m === null) {
            // The quote never closes: it is a literal character, and the
            // text after it is read again as unquoted.
            line = openLine;
            errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
            pos = open + 1;
            const r = unquoted('"');
            value = r.v;
            ended = r.e;
            closed = true;
            break;
          }
          const i = m.index;
          const c = text.charCodeAt(i);
          if (c === 34) {
            if (text.charCodeAt(i + 1) === 34) {
              // A doubled quote is one quote inside the field.
              if (parts === null) parts = [];
              parts.push(text.slice(segStart, i));
              parts.push('"');
              pos = i + 2;
              segStart = pos;
              continue;
            }
            // The closing quote.
            const seg = text.slice(segStart, i);
            value = parts === null ? seg : parts.join('') + seg;
            pos = i + 1;
            if (pos >= n) {
              ended = END;
            } else {
              const d = text.charCodeAt(pos);
              if (d === 44) {
                pos += 1;
                ended = COMMA;
              } else if (d === 10) {
                pos += 1;
                line += 1;
                ended = LINE;
              } else if (d === 13 && text.charCodeAt(pos + 1) === 10) {
                pos += 2;
                line += 1;
                ended = LINE;
              } else {
                // What follows the closing quote is appended as it stands,
                // up to the next comma or line break.
                const r = unquoted(value);
                if (r.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
                value = r.v;
                ended = r.e;
              }
            }
            closed = true;
          } else if (c === 10) {
            // LF inside quotes stays LF; the line count moves on.
            if (parts === null) parts = [];
            parts.push(text.slice(segStart, i + 1));
            line += 1;
            pos = i + 1;
            segStart = pos;
          } else {
            // CR inside quotes (CRLF or lone) is one LF.
            if (parts === null) parts = [];
            parts.push(text.slice(segStart, i));
            parts.push('\n');
            line += 1;
            pos = i + 1;
            if (text.charCodeAt(pos) === 10) pos += 1;
            segStart = pos;
          }
        }
        fields.push(value);
      } else {
        lastQuoted = false;
        const r = unquoted('');
        fields.push(r.v);
        ended = r.e;
      }
    } while (ended === COMMA);
    }

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) {
      if (ended === END) break;
      continue;
    }

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      if (ended === END) break;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
    if (ended === END) break;
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}

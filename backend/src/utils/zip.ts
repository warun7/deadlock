/**
 * Minimal ZIP writer, used to hand files to Judge0.
 *
 * WHY
 * ---
 * Judge0 accepts `additional_files` as a base64-encoded ZIP whose contents are
 * extracted into the sandbox (`/box`). That is how the judge supplies a problem
 * checker with the three files it expects:
 *
 *     python checker.py in.txt exp.txt sub.txt
 *
 * The alternative is pulling in a zip library, which is a lot of dependency for
 * writing three small files. Entries are STORED (not deflated): the payloads are
 * a few kilobytes and complexity here would buy nothing. Only the CRC-32 and
 * the three record structures are actually required by the ZIP spec.
 *
 * Sizes are 32-bit, so entries must stay well under 4 GB — true by orders of
 * magnitude, since test cases are capped at 200 KB each.
 */
import { crc32 } from 'zlib';

interface ZipEntry {
  name: string;
  data: string;
}

const LOCAL_HEADER_SIG = 0x04034b50;
const CENTRAL_HEADER_SIG = 0x02014b50;
const END_OF_CENTRAL_SIG = 0x06054b50;

/** MS-DOS time/date. Fixed value: these are ephemeral sandbox files. */
const DOS_TIME = 0;
const DOS_DATE = 0x2821; // 2000-01-01

export function createZip(entries: ZipEntry[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const dataBuf = Buffer.from(entry.data, 'utf8');
    const crc = crc32(dataBuf) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_HEADER_SIG, 0);
    local.writeUInt16LE(20, 4); // version needed to extract
    local.writeUInt16LE(0, 6); // general purpose flags
    local.writeUInt16LE(0, 8); // compression: 0 = stored
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(dataBuf.length, 18); // compressed size
    local.writeUInt32LE(dataBuf.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra field length

    chunks.push(local, nameBuf, dataBuf);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(CENTRAL_HEADER_SIG, 0);
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(DOS_TIME, 12);
    cd.writeUInt16LE(DOS_DATE, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(dataBuf.length, 20);
    cd.writeUInt32LE(dataBuf.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30); // extra
    cd.writeUInt16LE(0, 32); // comment
    cd.writeUInt16LE(0, 34); // disk number start
    cd.writeUInt16LE(0, 36); // internal attributes
    cd.writeUInt32LE(0, 38); // external attributes
    cd.writeUInt32LE(offset, 42); // offset of local header

    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + dataBuf.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_SIG, 0);
  end.writeUInt16LE(0, 4); // this disk
  end.writeUInt16LE(0, 6); // disk with central directory
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16); // central directory offset
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...chunks, centralBuf, end]);
}

export function createZipBase64(entries: ZipEntry[]): string {
  return createZip(entries).toString('base64');
}

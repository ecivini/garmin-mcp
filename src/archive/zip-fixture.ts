import { crc32, deflateRawSync } from "node:zlib";

type FixtureMember = {
  name: string;
  bytes: Buffer;
  compress?: boolean;
  zipCrc?: number;
  flags?: number;
  method?: number;
};

export function zipArchive(members: FixtureMember[]) {
  const data: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;

  for (const member of members) {
    const name = Buffer.from(member.name);
    const payload = member.compress ? deflateRawSync(member.bytes) : member.bytes;
    const checksum = member.zipCrc ?? crc32(member.bytes);
    const method = member.method ?? (member.compress ? 8 : 0);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(member.flags ?? 0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(member.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    data.push(local, name, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(member.flags ?? 0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(member.bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, name);
    offset += local.length + name.length + payload.length;
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(members.length, 8);
  end.writeUInt16LE(members.length, 10);
  end.writeUInt32LE(directory.reduce((total, part) => total + part.length, 0), 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...data, ...directory, end]);
}

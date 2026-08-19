// Upstash Redis REST wrapper - sima fetch, nincs SDK.

const BASE_URL = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function command(args) {
  if (!BASE_URL || !TOKEN) {
    throw new Error("Upstash Redis kornyezeti valtozok hianyoznak (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN)");
  }

  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Upstash Redis hiba (${res.status}): ${text}`);
  }

  const data = await res.json();
  if (data.error) {
    throw new Error(`Upstash Redis hiba: ${data.error}`);
  }
  return data.result;
}

export async function get(key) {
  return command(["GET", key]);
}

export async function set(key, value, opts = {}) {
  const args = ["SET", key, value];
  if (opts.ex) args.push("EX", String(opts.ex));
  return command(args);
}

export async function del(key) {
  return command(["DEL", key]);
}

export async function incr(key) {
  return command(["INCR", key]);
}

export async function expire(key, seconds) {
  return command(["EXPIRE", key, String(seconds)]);
}

export async function lpush(key, value) {
  return command(["LPUSH", key, value]);
}

export async function lrange(key, start, stop) {
  return command(["LRANGE", key, String(start), String(stop)]);
}

export async function sadd(key, member) {
  return command(["SADD", key, member]);
}

export async function srem(key, member) {
  return command(["SREM", key, member]);
}

export async function smembers(key) {
  return command(["SMEMBERS", key]);
}

export async function hincrby(key, field, increment) {
  return command(["HINCRBY", key, field, String(increment)]);
}

export async function hgetall(key) {
  return command(["HGETALL", key]);
}

export async function ping() {
  return command(["PING"]);
}

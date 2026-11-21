// Ochrona przed brute-force i password spraying (OWASP ASVS V2.2.1)

const IP_WINDOW_SECONDS = 900; // 15 minut
const IP_MAX_FAILURES = Number(process.env.LOGIN_IP_MAX_FAILURES) || 20;

function ipKey(ip) {
  return `auth:rl:ip:${ip || 'unknown'}`;
}

export async function checkLoginIpRateLimit(redis, ip) {
  const key = ipKey(ip);
  const raw = await redis.get(key);
  const count = Number(raw || 0);
  if (count >= IP_MAX_FAILURES) {
    const ttl = await redis.ttl(key);
    return {
      allowed: false,
      retryAfterSeconds: ttl > 0 ? ttl : IP_WINDOW_SECONDS,
    };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export async function recordLoginIpFailure(redis, ip) {
  const key = ipKey(ip);
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, IP_WINDOW_SECONDS);
  }
  return count;
}

// Progresywna blokada konta bez trwałego DoS (cap 30 min)
export function computeLockoutUntil(failedAttempts) {
  if (failedAttempts >= 15) {
    return new Date(Date.now() + 30 * 60 * 1000);
  }
  if (failedAttempts >= 10) {
    return new Date(Date.now() + 15 * 60 * 1000);
  }
  if (failedAttempts >= 5) {
    return new Date(Date.now() + 5 * 60 * 1000);
  }
  return null;
}


const HACKATIME_API_BASE = "https://hackatime.hackclub.com/api/v1";
const HACKATIME_WAKATIME_API_BASE =
  "https://hackatime.hackclub.com/api/hackatime/v1";
const GITHUB_OWNER = "ak4duy";
const ACTIVE_HEARTBEAT_WINDOW_MS = 5 * 60 * 1000;

function getAllowedRequestHeaders(request) {
  return (
    request.headers.get("access-control-request-headers") ?? "content-type"
  );
}

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      ...init.headers,
    },
  });
}

function normalizeDiscordDynamicValue(name, value) {
  if (name === "dailyTotal" && (value === "Start coding to track your time" || value === "Start coding!")) {
    return "not yet";
  }

  return value ?? "";
}

function discordDynamic(name, value) {
  return {
    type: 1,
    name,
    value: normalizeDiscordDynamicValue(name, value),
  };
}

function toDiscordHackatimeWidget(data) {
  return {
    data: {
      dynamic: [
        discordDynamic("dailyTotal", data.dailyTotal),
        discordDynamic("weeklyTotal", data.weeklyTotal),
        discordDynamic("totalTime", data.totalTime),
        discordDynamic("entity", data.entity || "chilling"),
        discordDynamic("topLanguage", data.topLanguage),
        discordDynamic("topProject", data.topProject),
      ],
    },
  };
}

function normalizeApiKey(apiKey) {
  return apiKey
    .trim()
    .replace(/^[']|[']$/g, "")
    .replace(/^[\"]|[\"]$/g, "")
    .replace(/^Bearer\s+/i, "")
    .replace(/^Basic\s+/i, "");
}

function getAuthHeaders(apiKey, scheme) {
  const normalizedApiKey = normalizeApiKey(apiKey);

  if (scheme === "bearer") {
    return { Authorization: `Bearer ${normalizedApiKey}` };
  }

  if (scheme === "basic-with-colon") {
    return { Authorization: `Basic ${btoa(`${normalizedApiKey}:`)}` };
  }

  return { Authorization: `Basic ${btoa(normalizedApiKey)}` };
}

function getUrlWithApiKey(url, apiKey) {
  const authenticatedUrl = new URL(url);
  authenticatedUrl.searchParams.set("api_key", normalizeApiKey(apiKey));

  return authenticatedUrl.toString();
}

function getIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function getTodayRange() {
  const now = new Date();
  const today = getIsoDate(now);

  return { startDate: today, endDate: today };
}

function getLastSevenDaysRange() {
  const now = new Date();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  start.setUTCDate(start.getUTCDate() - 6);

  return { startDate: getIsoDate(start), endDate: getIsoDate(now) };
}

function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return "0m";
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.round((totalSeconds % 3600) / 60);

  if (hours <= 0) {
    return `${minutes}m`;
  }

  if (minutes <= 0) {
    return `${hours}h`;
  }

  return `${hours}h ${minutes}m`;
}

function normalizeTotalSeconds(payload) {
  const data = getPayloadData(payload);
  const totalSeconds = data?.total_seconds;

  return typeof totalSeconds === "number" && Number.isFinite(totalSeconds)
    ? totalSeconds
    : null;
}

function normalizeStatsItem(item) {
  if (!item || typeof item.name !== "string" || item.name.trim().length === 0) {
    return null;
  }

  const totalSeconds = item.total_seconds;

  return {
    name: item.name.trim(),
    totalSeconds:
      typeof totalSeconds === "number" && Number.isFinite(totalSeconds)
        ? totalSeconds
        : 0,
    text:
      typeof item.text === "string"
        ? item.text
        : formatDuration(totalSeconds ?? 0),
    percent:
      typeof item.percent === "number" && Number.isFinite(item.percent)
        ? item.percent
        : null,
  };
}

function getPayloadData(payload) {
  return payload?.data ?? payload;
}

function normalizeProjectName(payload) {
  const data = getPayloadData(payload);

  const candidates = [
    data?.project,
    data?.project_name,
    data?.heartbeat?.project,
    data?.latest_heartbeat?.project,
    data?.current_project,
    data?.current?.project,
    data?.current?.project_name,
    data?.status_bar?.project,
    data?.status_bar?.project_name,
    data?.summary?.project,
    data?.summary?.project_name,
    data?.projects?.[0]?.name,
    data?.projects?.[0]?.project,
    data?.projects?.[0]?.project_name,
  ];

  return candidates
    .find(
      (candidate) =>
        typeof candidate === "string" && candidate.trim().length > 0,
    )
    ?.trim();
}

function normalizeHeartbeatTime(payload) {
  const data = getPayloadData(payload);

  const candidates = [
    data?.time,
    data?.timestamp,
    data?.created_at,
    data?.updated_at,
    data?.heartbeat?.time,
    data?.heartbeat?.timestamp,
    data?.heartbeat?.created_at,
    data?.heartbeat?.updated_at,
    data?.latest_heartbeat?.time,
    data?.latest_heartbeat?.timestamp,
    data?.latest_heartbeat?.created_at,
    data?.latest_heartbeat?.updated_at,
    data?.current?.time,
    data?.current?.timestamp,
    data?.current?.created_at,
    data?.current?.updated_at,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      const milliseconds =
        candidate < 1_000_000_000_000 ? candidate * 1000 : candidate;
      return new Date(milliseconds);
    }

    if (typeof candidate === "string" && candidate.trim().length > 0) {
      const date = new Date(candidate);

      if (!Number.isNaN(date.getTime())) {
        return date;
      }
    }
  }

  return null;
}

function isActiveHeartbeat(heartbeatTime) {
  if (!heartbeatTime) {
    return false;
  }

  const ageMs = Date.now() - heartbeatTime.getTime();

  return ageMs >= 0 && ageMs <= ACTIVE_HEARTBEAT_WINDOW_MS;
}

function normalizeEntity(payload) {
  const data = getPayloadData(payload);

  const candidates = [
    data?.entity,
    data?.file,
    data?.file_path,
    data?.filePath,
    data?.path,
    data?.heartbeat?.entity,
    data?.heartbeat?.file,
    data?.heartbeat?.file_path,
    data?.heartbeat?.filePath,
    data?.heartbeat?.path,
    data?.latest_heartbeat?.entity,
    data?.latest_heartbeat?.file,
    data?.latest_heartbeat?.file_path,
    data?.latest_heartbeat?.filePath,
    data?.latest_heartbeat?.path,
    data?.current?.entity,
    data?.current?.file,
    data?.current?.file_path,
    data?.current?.filePath,
    data?.current?.path,
  ];

  const entity = candidates.find(
    (candidate) => typeof candidate === "string" && candidate.trim().length > 0,
  );

  if (!entity) {
    return null;
  }

  return (
    entity
      .trim()
      .split(/[\\/]+/)
      .filter(Boolean)
      .pop() ?? entity.trim()
  );
}

function normalizeRepoUrl(payload) {
  const data = getPayloadData(payload);

  const candidates = [
    data?.repo,
    data?.repository,
    data?.repo_url,
    data?.repoUrl,
    data?.repoURL,
    data?.RepoURL,
    data?.repository_url,
    data?.repositoryUrl,
    data?.repositoryURL,
    data?.RepositoryURL,
    data?.html_url,
    data?.htmlUrl,
    data?.HTMLURL,
    data?.heartbeat?.repo,
    data?.heartbeat?.repository,
    data?.heartbeat?.repo_url,
    data?.heartbeat?.repoUrl,
    data?.heartbeat?.repoURL,
    data?.heartbeat?.RepoURL,
    data?.heartbeat?.repository_url,
    data?.heartbeat?.repositoryUrl,
    data?.heartbeat?.repositoryURL,
    data?.heartbeat?.RepositoryURL,
    data?.latest_heartbeat?.repo,
    data?.latest_heartbeat?.repository,
    data?.latest_heartbeat?.repo_url,
    data?.latest_heartbeat?.repoUrl,
    data?.latest_heartbeat?.repoURL,
    data?.latest_heartbeat?.RepoURL,
    data?.latest_heartbeat?.repository_url,
    data?.latest_heartbeat?.repositoryUrl,
    data?.latest_heartbeat?.repositoryURL,
    data?.latest_heartbeat?.RepositoryURL,
    data?.current?.repo,
    data?.current?.repository,
    data?.current?.repo_url,
    data?.current?.repoUrl,
    data?.current?.repoURL,
    data?.current?.RepoURL,
    data?.current?.repository_url,
    data?.current?.repositoryUrl,
    data?.current?.repositoryURL,
    data?.current?.RepositoryURL,
    data?.projects?.[0]?.repo,
    data?.projects?.[0]?.repository,
    data?.projects?.[0]?.repo_url,
    data?.projects?.[0]?.repoUrl,
    data?.projects?.[0]?.repoURL,
    data?.projects?.[0]?.RepoURL,
    data?.projects?.[0]?.repository_url,
    data?.projects?.[0]?.repositoryUrl,
    data?.projects?.[0]?.repositoryURL,
    data?.projects?.[0]?.RepositoryURL,
  ];

  const repoUrl = candidates.find(
    (candidate) =>
      typeof candidate === "string" && /^https?:\/\//i.test(candidate.trim()),
  );

  return repoUrl?.trim();
}

function getGithubRepoApiUrl(project) {
  if (!project || !/^[A-Za-z0-9._-]+$/.test(project)) {
    return null;
  }

  return `https://api.github.com/repos/${GITHUB_OWNER}/${project}`;
}

async function fetchGithubRepoUrl(project) {
  const repoApiUrl = getGithubRepoApiUrl(project);

  if (!repoApiUrl) {
    return null;
  }

  const response = await fetch(repoApiUrl, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "akaduy-dev-hackatime-status-worker",
    },
  });

  if (!response.ok) {
    return null;
  }

  const repo = await response.json();

  return typeof repo.html_url === "string" ? repo.html_url : null;
}

async function fetchWithAuthVariants(url, apiKey, attemptLog) {
  const normalizedApiKey = normalizeApiKey(apiKey);
  const attempts = [
    {
      auth: "bearer",
      fetch: () =>
        fetch(url, { headers: getAuthHeaders(normalizedApiKey, "bearer") }),
    },
    {
      auth: "query-api-key",
      fetch: () => fetch(getUrlWithApiKey(url, normalizedApiKey)),
    },
    {
      auth: "basic",
      fetch: () =>
        fetch(url, { headers: getAuthHeaders(normalizedApiKey, "basic") }),
    },
    {
      auth: "basic-with-colon",
      fetch: () =>
        fetch(url, {
          headers: getAuthHeaders(normalizedApiKey, "basic-with-colon"),
        }),
    },
  ];

  let response;

  for (const attempt of attempts) {
    response = await attempt.fetch();
    attemptLog.push({ url, auth: attempt.auth, status: response.status });

    if (response.ok) {
      return response;
    }

    if (response.status !== 401 && response.status !== 403) {
      break;
    }
  }

  return response;
}

async function fetchHackatimeStatus(apiKey) {
  const urls = [
    `${HACKATIME_API_BASE}/authenticated/heartbeats/latest`,
    `${HACKATIME_API_BASE}/my/heartbeats/most_recent`,
  ];
  const attemptLog = [];
  let response;

  for (const url of urls) {
    response = await fetchWithAuthVariants(url, apiKey, attemptLog);

    if (response?.ok) {
      return {
        payload: await response.json(),
        attemptLog,
      };
    }
  }

  const error = new Error(
    `Hackatime responded with ${response?.status ?? "unknown"}`,
  );
  error.attemptLog = attemptLog;
  throw error;
}

async function fetchHackatimeDailyTotal(apiKey) {
  const { startDate, endDate } = getTodayRange();
  const url = `${HACKATIME_WAKATIME_API_BASE}/users/current/statusbar/today`;
  const attemptLog = [];
  const response = await fetchWithAuthVariants(url, apiKey, attemptLog);

  if (!response?.ok) {
    const error = new Error(
      `Hackatime daily total responded with ${response?.status ?? "unknown"}`,
    );
    error.attemptLog = attemptLog;
    throw error;
  }

  const payload = await response.json();
  const totalSeconds = payload?.data?.grand_total?.total_seconds;

  return {
    startDate,
    endDate,
    totalSeconds:
      typeof totalSeconds === "number" && Number.isFinite(totalSeconds)
        ? totalSeconds
        : 0,
    text:
      typeof payload?.data?.grand_total?.text === "string"
        ? payload.data.grand_total.text
        : formatDuration(totalSeconds ?? 0),
  };
}

async function fetchHackatimeStats(apiKey, range) {
  const attemptLog = [];
  const response = await fetchWithAuthVariants(
    `${HACKATIME_WAKATIME_API_BASE}/users/current/stats/${range}`,
    apiKey,
    attemptLog,
  );

  if (!response?.ok) {
    const error = new Error(
      `Hackatime ${range} stats responded with ${response?.status ?? "unknown"}`,
    );
    error.attemptLog = attemptLog;
    throw error;
  }

  return getPayloadData(await response.json());
}

function normalizeStatsTotal(data, fallbackRange) {
  const totalSeconds =
    typeof data?.total_seconds === "number" &&
    Number.isFinite(data.total_seconds)
      ? data.total_seconds
      : 0;

  return {
    startDate:
      typeof data?.start === "string" ? data.start : fallbackRange.startDate,
    endDate: typeof data?.end === "string" ? data.end : fallbackRange.endDate,
    totalSeconds,
    text:
      typeof data?.human_readable_total === "string"
        ? data.human_readable_total
        : formatDuration(totalSeconds),
  };
}

async function fetchHackatimeWeeklyStats(apiKey) {
  const data = await fetchHackatimeStats(apiKey, "last_7_days");

  return {
    username: typeof data?.username === "string" ? data.username : null,
    total: normalizeStatsTotal(data, getLastSevenDaysRange()),
    topLanguage: normalizeStatsItem(data?.languages?.[0]),
    topProject: normalizeStatsItem(data?.projects?.[0]),
  };
}

function normalizeSummaryItem(item, totalSeconds) {
  if (!item || typeof item.key !== "string" || item.key.trim().length === 0) {
    return null;
  }

  const itemSeconds = item.total;

  if (typeof itemSeconds !== "number" || !Number.isFinite(itemSeconds)) {
    return null;
  }

  return {
    name: item.key.trim(),
    totalSeconds: itemSeconds,
    text: formatDuration(itemSeconds),
    percent: totalSeconds > 0 ? (itemSeconds / totalSeconds) * 100 : null,
  };
}

async function fetchHackatimeAllTimeSummary(userIds) {
  const attempts = [];

  for (const userId of userIds) {
    if (typeof userId !== "string" || userId.trim().length === 0) {
      continue;
    }

    const url = new URL("https://hackatime.hackclub.com/api/summary");
    url.searchParams.set("interval", "all_time");
    url.searchParams.set("user_id", userId.trim());

    const response = await fetch(url.toString(), {
      headers: { accept: "application/json" },
    });
    attempts.push({
      url: url.toString(),
      auth: "none",
      status: response.status,
    });

    if (!response.ok) {
      continue;
    }

    const payload = await response.json();
    const projects = Array.isArray(payload?.projects) ? payload.projects : [];
    const languages = Array.isArray(payload?.languages)
      ? payload.languages
      : [];
    const totalSeconds = projects.reduce((total, project) => {
      const projectSeconds = project?.total;

      return total + (typeof projectSeconds === "number" ? projectSeconds : 0);
    }, 0);
    const topProject = [...projects]
      .filter((project) => typeof project?.total === "number")
      .sort((a, b) => b.total - a.total)[0];
    const topLanguage = [...languages]
      .filter((language) => typeof language?.total === "number")
      .sort((a, b) => b.total - a.total)[0];

    return {
      totalTime: {
        startDate: typeof payload?.from === "string" ? payload.from : null,
        endDate: typeof payload?.to === "string" ? payload.to : null,
        totalSeconds,
        text: formatDuration(totalSeconds),
      },
      topLanguage: normalizeSummaryItem(topLanguage, totalSeconds),
      topProject: normalizeSummaryItem(topProject, totalSeconds),
    };
  }

  const error = new Error("Hackatime all-time summary lookup failed");
  error.attemptLog = attempts;
  throw error;
}

async function fetchOptional(fetchData) {
  try {
    return { data: await fetchData(), error: null };
  } catch (error) {
    return {
      data: null,
      error: {
        message: error instanceof Error ? error.message : "Unknown error",
        attempts: error?.attemptLog,
      },
    };
  }
}

async function getHackatimeData(env) {
  const [statusResult, dailyTotalResult, weeklyStatsResult] = await Promise.all(
    [
      fetchHackatimeStatus(env.HACKATIME_API_KEY),
      fetchOptional(() => fetchHackatimeDailyTotal(env.HACKATIME_API_KEY)),
      fetchOptional(() => fetchHackatimeWeeklyStats(env.HACKATIME_API_KEY)),
    ],
  );
  const { payload } = statusResult;
  const { data: dailyTotal } = dailyTotalResult;
  const weeklyStats = weeklyStatsResult.data;
  const weeklyTotal = weeklyStats?.total ?? null;
  const allTimeSummaryResult = await fetchOptional(() =>
    fetchHackatimeAllTimeSummary([
      env.HACKATIME_USER_ID,
      env.HACKATIME_USERNAME,
      env.HACKATIME_USER,
      weeklyStats?.username,
      "akaduy",
      GITHUB_OWNER,
    ]),
  );
  const { data: allTimeSummary } = allTimeSummaryResult;
  const heartbeatTime = normalizeHeartbeatTime(payload);
  const active = isActiveHeartbeat(heartbeatTime);
  const project = active ? normalizeProjectName(payload) : null;
  const entity = active ? normalizeEntity(payload) : null;
  const repoUrl = project
    ? (normalizeRepoUrl(payload) ?? (await fetchGithubRepoUrl(project)))
    : null;
  const projectLabel = project
    ? `${project}${entity ? ` (${entity})` : ""}`
    : null;

  return {
    project,
    repoUrl,
    entity,
    projectLabel,
    text: projectLabel ? `currently working on ${projectLabel}` : null,
    active,
    lastHeartbeatAt: heartbeatTime?.toISOString() ?? null,
    dailyTotal: dailyTotal?.text ?? null,
    weeklyTotal: weeklyTotal?.text ?? null,
    totalTime: allTimeSummary?.totalTime?.text ?? null,
    topLanguage:
      allTimeSummary?.topLanguage?.name ??
      weeklyStats?.topLanguage?.name ??
      null,
    topProject:
      allTimeSummary?.topProject?.name ?? weeklyStats?.topProject?.name ?? null,
    totalsError:
      dailyTotalResult.error ||
      weeklyStatsResult.error ||
      allTimeSummaryResult.error
        ? {
            daily: dailyTotalResult.error,
            weekly: weeklyStatsResult.error,
            allTime: allTimeSummaryResult.error,
          }
        : null,
  };
}

function getDiscordProfileUrl(env) {
  if (!env.DISCORD_APPLICATION_ID || !env.DISCORD_USER_ID) {
    throw new Error("Missing Discord application or user ID secret");
  }

  return `https://discord.com/api/v9/applications/${env.DISCORD_APPLICATION_ID}/users/${env.DISCORD_USER_ID}/identities/0/profile`;
}

async function updateDiscordHackatimeWidget(env) {
  if (!env.DISCORD_BOT_TOKEN) {
    throw new Error("Missing DISCORD_BOT_TOKEN secret");
  }

  const data = await getHackatimeData(env);
  const body = toDiscordHackatimeWidget(data);
  const response = await fetch(getDiscordProfileUrl(env), {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      "user-agent":
        "DiscordBot (https://github.com/discord/discord-api-docs, 1.0.0)",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = new Error(`Discord responded with ${response.status}`);
    error.responseText = await response.text();
    throw error;
  }

  console.log("Discord Hackatime widget updated", {
    dailyTotal: data.dailyTotal,
    weeklyTotal: data.weeklyTotal,
    totalTime: data.totalTime,
    entity: data.entity,
    topLanguage: data.topLanguage,
    topProject: data.topProject,
  });

  return body;
}

export default {
  async fetch(request, env) {
    const requestUrl = new URL(request.url);
    const wantsDiscordWidget =
      requestUrl.pathname === "/discord/hackatime-widget";

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, OPTIONS",
          "access-control-allow-headers": getAllowedRequestHeaders(request),
        },
      });
    }

    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, { status: 405 });
    }

    if (!env.HACKATIME_API_KEY) {
      return json(
        { error: "Missing HACKATIME_API_KEY secret" },
        { status: 500 },
      );
    }

    try {
      if (requestUrl.pathname === "/discord/hackatime-widget/update") {
        return json(await updateDiscordHackatimeWidget(env));
      }

      const data = await getHackatimeData(env);

      return json(wantsDiscordWidget ? toDiscordHackatimeWidget(data) : data);
    } catch (error) {
      const data = {
        project: null,
        repoUrl: null,
        entity: null,
        projectLabel: null,
        text: null,
        active: false,
        lastHeartbeatAt: null,
        dailyTotal: null,
        weeklyTotal: null,
        totalTime: null,
        topLanguage: null,
        topProject: null,
        error: error instanceof Error ? error.message : "Unknown error",
        attempts: error?.attemptLog,
      };

      return json(wantsDiscordWidget ? toDiscordHackatimeWidget(data) : data, {
        status: 502,
      });
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      updateDiscordHackatimeWidget(env).catch((error) => {
        console.error("Discord Hackatime widget update failed", {
          message: error instanceof Error ? error.message : "Unknown error",
          responseText: error?.responseText,
        });
      }),
    );
  },
};

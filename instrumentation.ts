import { SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";

const posthogProjectToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;
const configured = Boolean(posthogProjectToken && posthogHost);

if (!configured && process.env.NODE_ENV === "development") {
  const variableName = posthogProjectToken ? "NEXT_PUBLIC_POSTHOG_HOST" : "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN";
  console.error(
    new Error(
      `${variableName} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${variableName} is configured`,
    ),
  );
}

export const posthogLoggerProvider = posthogProjectToken && posthogHost
  ? new LoggerProvider({
      resource: resourceFromAttributes({ "service.name": "weft" }),
      processors: [
        new BatchLogRecordProcessor({
          exporter: new OTLPLogExporter({
            url: `${posthogHost.replace(/\/$/, "")}/i/v1/logs`,
            headers: {
              Authorization: `Bearer ${posthogProjectToken}`,
              "Content-Type": "application/json",
            },
          }),
        }),
      ],
    })
  : null;

const posthogLogger = posthogLoggerProvider?.getLogger("weft.posthog");

type PostHogLogAttributes = Record<string, boolean | number | string>;

// This isolated logger intentionally excludes the application's existing console output.
export function emitPostHogLog(message: string, attributes: PostHogLogAttributes) {
  posthogLogger?.emit({ body: message, severityNumber: SeverityNumber.INFO, attributes });
}

export async function flushPostHogLogs() {
  await posthogLoggerProvider?.forceFlush();
}

export function register() {
  // Keep this provider dedicated to the purpose-written PostHog log lines above.
}

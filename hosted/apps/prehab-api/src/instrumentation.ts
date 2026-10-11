import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { ORPCInstrumentation } from "@orpc/otel";

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "prehab-api",
    }),
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      new PgInstrumentation({ enhancedDatabaseReporting: true }),
      new ORPCInstrumentation(),
    ],
  });

  sdk.start();
  console.log(`[otel] tracing enabled → ${process.env.OTEL_EXPORTER_OTLP_ENDPOINT} (prehab-api)`);
}

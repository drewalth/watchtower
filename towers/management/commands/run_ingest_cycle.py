"""Run one full data-refresh cycle, recording its state for the UI.

Wraps the four ingest steps the hourly scheduler used to call individually
(ingest_fires → ingest_weather → compute_fire_risk → predict_ignition) in a
single command that brackets them with an IngestionRun row: ``running`` at the
start, ``completed``/``failed`` at the end. Each step is isolated (a failure is
recorded and the rest still run, mirroring the old ``|| true`` loop), so one bad
step never aborts the cycle. The frontend polls the latest IngestionRun to show
a progress toast.
"""
from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.utils import timezone

from towers.models import IngestionRun

# (label, command name, kwargs) for each step, in order.
STEPS = [
    ("ingest_fires", "ingest_fires", {"day_range": 2}),
    ("ingest_weather", "ingest_weather", {}),
    ("compute_fire_risk", "compute_fire_risk", {}),
    ("predict_ignition", "predict_ignition", {}),
]


class Command(BaseCommand):
    help = "Run the full ingest cycle, tracking progress in an IngestionRun row."

    def handle(self, *args, **options):
        run = IngestionRun.objects.create(status=IngestionRun.Status.RUNNING)
        results = []
        failures = 0
        for label, command, kwargs in STEPS:
            try:
                call_command(command, **kwargs)
                results.append(f"{label}: ok")
            except Exception as exc:  # isolate like the old `|| true` loop
                failures += 1
                results.append(f"{label}: failed ({exc})")
                self.stderr.write(self.style.ERROR(f"{label} failed: {exc}"))

        # Failed only if *every* step raised; otherwise the refresh did something.
        run.status = (
            IngestionRun.Status.FAILED
            if failures == len(STEPS)
            else IngestionRun.Status.COMPLETED
        )
        run.finished_at = timezone.now()
        run.detail = "; ".join(results)
        run.save(update_fields=["status", "finished_at", "detail"])

        self.stdout.write(self.style.SUCCESS(
            f"Ingest cycle {run.status} — {run.detail}"
        ))

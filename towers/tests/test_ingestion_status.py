"""The ingestion-status endpoint that backs the data-refresh toast."""
import pytest
from django.urls import reverse
from django.utils import timezone

from towers.models import IngestionRun


@pytest.mark.django_db
def test_ingestion_status_null_before_any_run(client):
    assert client.get(reverse("ingestion-status")).json() == {"run": None}


@pytest.mark.django_db
def test_ingestion_status_returns_latest_run(client):
    IngestionRun.objects.create(
        status=IngestionRun.Status.COMPLETED, finished_at=timezone.now()
    )
    latest = IngestionRun.objects.create(status=IngestionRun.Status.RUNNING)

    run = client.get(reverse("ingestion-status")).json()["run"]
    assert run["id"] == latest.id
    assert run["status"] == "running"
    assert run["started_at"] is not None
    assert run["finished_at"] is None

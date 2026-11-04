"""Low-overhead stage timings and heartbeat logs for blocking model loaders."""

import threading
import time

from .i18n import tr


class LoadingStage:
    def __init__(self, logger, model, stage, interval=10.0, total=None):
        self.logger = logger
        self.model = model
        self.stage = tr(stage)
        self.interval = interval
        self.total = total
        self.completed = 0
        self._stop = threading.Event()

    def _log(self, message):
        self.logger.info(tr(message, model=self.model, stage=self.stage,
                            seconds=f"{time.perf_counter() - self.started:.1f}"))

    def _heartbeat(self):
        while not self._stop.wait(self.interval):
            if self.total:
                self.logger.info(tr(
                    "load_stage_progress", model=self.model, stage=self.stage,
                    percent=f"{min(100, self.completed / self.total * 100):.1f}",
                    seconds=f"{time.perf_counter() - self.started:.1f}",
                ))
            else:
                self._log("load_stage_waiting")

    def __enter__(self):
        self.started = time.perf_counter()
        self._log("load_stage_started")
        self._thread = threading.Thread(target=self._heartbeat, daemon=True,
                                        name="model-loading-progress")
        self._thread.start()
        return self

    def advance(self, count):
        self.completed += count

    def __exit__(self, exc_type, exc_value, traceback):
        self._stop.set()
        self._thread.join()
        self._log("load_stage_failed" if exc_type else "load_stage_finished")
        return False

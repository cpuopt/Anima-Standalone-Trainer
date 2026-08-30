import torch

from library import anima_train_utils, train_util


class _VelocityModel(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.anchor = torch.nn.Parameter(torch.zeros(()))
        self.blocks_to_swap = 0
        self.calls = 0

    def forward(self, x, timestep, crossattn_emb, padding_mask=None):
        self.calls += 1
        time_value = timestep.reshape(-1, *([1] * (x.ndim - 1)))
        return x * 0.1 + time_value


def test_anima_sigma_schedules_are_descending_and_end_at_zero():
    for scheduler in anima_train_utils.ANIMA_SAMPLE_SCHEDULERS:
        sigmas = anima_train_utils._build_sigma_schedule(
            8, scheduler, torch.device("cpu"), torch.float32
        )
        assert sigmas.shape == (9,)
        assert sigmas[0].item() == 1.0
        assert sigmas[-1].item() == 0.0
        assert torch.all(sigmas[:-1] > sigmas[1:])


def test_heun_uses_corrector_evaluations_and_differs_from_euler():
    common = dict(
        height=64,
        width=64,
        seed=123,
        crossattn_emb=torch.zeros(1, 1, 1),
        steps=4,
        dtype=torch.float32,
        device=torch.device("cpu"),
        scheduler="linear",
    )
    euler_model = _VelocityModel()
    heun_model = _VelocityModel()

    euler = anima_train_utils.do_sample(dit=euler_model, sampler="euler", **common)
    heun = anima_train_utils.do_sample(dit=heun_model, sampler="heun", **common)

    assert euler_model.calls == 4
    assert heun_model.calls == 7  # predictor + corrector except at sigma=0
    assert not torch.equal(euler, heun)


def test_prompt_line_parses_anima_sampler_and_scheduler():
    prompt = train_util.line_to_prompt_dict(
        "a portrait --w 832 --h 1216 --ss heun --sched karras --n blurry"
    )
    assert prompt["prompt"] == "a portrait"
    assert prompt["sample_sampler"] == "heun"
    assert prompt["sample_scheduler"] == "karras"
    assert prompt["negative_prompt"] == "blurry"

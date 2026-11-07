from server import PromptServer

from .resources import resource_stats


class SBDSStudio:
    """Canvas entry point for the studio's frontend."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}}

    RETURN_TYPES = ()
    FUNCTION = "open_studio"
    CATEGORY = "audio/SBDS"

    def open_studio(self):
        return ()


class SBDSReleaseAfterTake:
    """Request cleanup on the ComfyUI worker after the audio has been saved."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"saved_audio": ("AUDIO",)}}

    @classmethod
    def IS_CHANGED(cls, saved_audio):
        return float("nan")

    RETURN_TYPES = ()
    FUNCTION = "release"
    OUTPUT_NODE = True
    CATEGORY = "audio/SBDS"

    def release(self, saved_audio):
        queue = PromptServer.instance.prompt_queue
        queue.set_flag("unload_models", True)
        queue.set_flag("free_memory", True)
        return ()


PromptServer.instance.routes.get("/sbds/resources")(resource_stats)

NODE_CLASS_MAPPINGS = {
    "SBDSStudio": SBDSStudio,
    "SBDSReleaseAfterTake": SBDSReleaseAfterTake,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "SBDSStudio": "SBDS · Sound Band Design Studio",
    "SBDSReleaseAfterTake": "SBDS · Release Memory After Take",
}
WEB_DIRECTORY = "./web"

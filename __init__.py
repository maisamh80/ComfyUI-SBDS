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


PromptServer.instance.routes.get("/sbds/resources")(resource_stats)

NODE_CLASS_MAPPINGS = {
    "SBDSStudio": SBDSStudio,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "SBDSStudio": "SBDS · Sound Band Design Studio",
}
WEB_DIRECTORY = "./web"

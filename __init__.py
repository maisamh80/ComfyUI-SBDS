from server import PromptServer

from .audio_export import export_audio
from .projects import register_project_routes
from .resources import resource_stats
from .updates import register_update_routes


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
PromptServer.instance.routes.get("/sbds/export")(export_audio)
register_project_routes(PromptServer.instance)
register_update_routes(PromptServer.instance)

NODE_CLASS_MAPPINGS = {
    "SBDSStudio": SBDSStudio,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "SBDSStudio": "SBDS · Sound Band Design Studio",
}
WEB_DIRECTORY = "./web"

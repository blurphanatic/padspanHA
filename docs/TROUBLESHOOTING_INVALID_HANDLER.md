# Troubleshooting: Invalid handler specified

If Home Assistant shows:

`Config flow could not be loaded: {"message":"Invalid handler specified"}`

Use this hotfix build and ensure:

1. Only one folder exists at:
   `/config/custom_components/padspan_ha`
2. Remove old versions:
   - delete `/config/custom_components/padspan_ha`
   - restart HA
   - copy this hotfix folder back
   - restart HA again
3. Clear browser cache / hard refresh.
4. Check logs for `custom_components.padspan_ha.config_flow` import errors.

This hotfix reduces config-flow import dependencies to maximize compatibility.

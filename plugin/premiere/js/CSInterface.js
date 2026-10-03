/**
 * CSInterface - Adobe Extensibility Platform Interface
 */

function CSInterface() {
    this.hostEnvironment = null;
}

CSInterface.THEME_COLOR_CHANGED_EVENT = "com.adobe.csxs.events.ThemeColorChanged";

CSInterface.prototype.evalScript = function(script, callback) {
    if (window.__adobe_cep__) {
        window.__adobe_cep__.evalScript(script, callback || function() {});
    } else {
        if (callback) callback("ERR_NO_CEP");
    }
};

CSInterface.prototype.getHostEnvironment = function() {
    if (window.__adobe_cep__) {
        this.hostEnvironment = JSON.parse(window.__adobe_cep__.getHostEnvironment());
        return this.hostEnvironment;
    }
    return null;
};

CSInterface.prototype.openURLInDefaultBrowser = function(url) {
    if (typeof cep !== 'undefined' && cep.util && cep.util.openURLInDefaultBrowser) {
        cep.util.openURLInDefaultBrowser(url);
    } else {
        window.open(url, "_blank");
    }
};

if (typeof module !== 'undefined') {
    module.exports = CSInterface;
}

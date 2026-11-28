fn main() {
    let cfg = slint_build::CompilerConfiguration::new()
        .with_style("fluent".into())
        .with_bundled_translations("lang")
        .with_default_translation_context(slint_build::DefaultTranslationContext::None);
    slint_build::compile_with_config("ui/app.slint", cfg).expect("Slint UI");
    // Spanish strings for server messages come from the web app's dictionary (public/js/es.js)
    println!("cargo:rerun-if-changed=../../../public/js/es.js");
    #[cfg(windows)]
    {
        let mut r = winresource::WindowsResource::new();
        r.set_icon("icons/nebulix.ico");
        r.set("ProductName", "Nebulix");
        r.set("FileDescription", "Nebulix");
        let _ = r.compile();
    }
}

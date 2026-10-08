use tauri_plugin_deep_link::DeepLinkExt;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            match app.deep_link().register_all() {
                Ok(_) => println!("[deep-link] register_all() -> Ok"),
                Err(e) => println!("[deep-link] register_all() -> ERR: {e:?}"),
            }
            match app.deep_link().get_current() {
                Ok(Some(urls)) => println!("[deep-link] get_current -> {:?}", urls),
                Ok(None) => println!("[deep-link] get_current -> None"),
                Err(e) => println!("[deep-link] get_current -> ERR: {e:?}"),
            }
            match app.deep_link().is_registered("self-notion") {
                Ok(v) => println!("[deep-link] is_registered(self-notion) -> {v}"),
                Err(e) => println!("[deep-link] is_registered -> ERR: {e:?}"),
            }
            println!("[deep-link] MODE=bundled? see CFBundle");
            app.deep_link().on_open_url(|event| {
                println!("[deep-link] OPEN_URL EVENT -> {:?}", event.urls());
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error running dl-probe");
}

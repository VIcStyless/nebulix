use std::time::Instant;
fn main() {
    let t = Instant::now(); let st = nebulix_local::android::status(); println!("status {:?} {:?}", st, t.elapsed());
    let t = Instant::now(); let r = nebulix_local::android::running(); println!("running {:?} {:?}", r, t.elapsed());
    let t = Instant::now(); let a = nebulix_local::android::accel_check(); println!("accel {:?} {:?}", a, t.elapsed());
}

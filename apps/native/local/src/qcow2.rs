//! Create an empty qcow2 (version 3) disk without qemu-img, so the app works on machines that only have the QEMU
//! system emulator. qcow2 gives thin provisioning and internal snapshots (savevm / loadvm).
//! Layout (64 KiB clusters): cluster 0 header, cluster 1 refcount table, cluster 2 refcount block, cluster 3 L1 table.
//! The refcount block marks clusters 0-3 (+ any extra L1 clusters) as used; QEMU grows the image from there.
use std::fs::File;
use std::io::{Seek, SeekFrom, Write};
use std::path::Path;

const CLUSTER_BITS: u32 = 16;
const CLUSTER: u64 = 1 << CLUSTER_BITS;

pub fn create(path: &Path, size_bytes: u64) -> std::io::Result<()> {
    if size_bytes == 0 || size_bytes > (64u64 << 40) { return Err(std::io::Error::other("disk size must be between 1 byte and 64 TiB")); }
    let size = size_bytes.div_ceil(512) * 512;
    let l2_entries = CLUSTER / 8; // one L2 table maps 8192 clusters = 512 MiB
    let l1_size = size.div_ceil(CLUSTER * l2_entries); // L1 entries needed
    let l1_clusters = (l1_size * 8).div_ceil(CLUSTER).max(1);
    let used = 3 + l1_clusters; // header, refcount table, refcount block, L1
    if used > CLUSTER / 2 { return Err(std::io::Error::other("disk too large for a single refcount block")); }

    let mut f = File::create(path)?;
    let mut h = vec![0u8; 104];
    let put32 = |b: &mut [u8], o: usize, v: u32| b[o..o + 4].copy_from_slice(&v.to_be_bytes());
    let put64 = |b: &mut [u8], o: usize, v: u64| b[o..o + 8].copy_from_slice(&v.to_be_bytes());
    h[0..4].copy_from_slice(b"QFI\xfb");
    put32(&mut h, 4, 3); // version
    put64(&mut h, 8, 0); // backing file offset
    put32(&mut h, 16, 0); // backing file size
    put32(&mut h, 20, CLUSTER_BITS);
    put64(&mut h, 24, size);
    put32(&mut h, 32, 0); // no encryption
    put32(&mut h, 36, l1_size as u32);
    put64(&mut h, 40, 3 * CLUSTER); // L1 table offset
    put64(&mut h, 48, CLUSTER); // refcount table offset
    put32(&mut h, 56, 1); // refcount table clusters
    put32(&mut h, 60, 0); // snapshots
    put64(&mut h, 64, 0);
    put64(&mut h, 72, 0); // incompatible features
    put64(&mut h, 80, 0); // compatible features
    put64(&mut h, 88, 0); // autoclear features
    put32(&mut h, 96, 4); // refcount order: 16-bit refcounts
    put32(&mut h, 100, 104); // header length
    f.write_all(&h)?;
    f.write_all(&[0u8; 8])?; // end of header extensions

    // refcount table: one entry pointing at the refcount block in cluster 2
    f.seek(SeekFrom::Start(CLUSTER))?;
    f.write_all(&(2 * CLUSTER).to_be_bytes())?;
    // refcount block: 16-bit refcount = 1 for each used cluster
    f.seek(SeekFrom::Start(2 * CLUSTER))?;
    for _ in 0..used { f.write_all(&1u16.to_be_bytes())?; }
    // L1 table stays zero (unallocated); extend the file to the end of the last metadata cluster
    f.set_len(used * CLUSTER)?;
    f.sync_all()
}

#[cfg(test)]
mod tests {
    #[test]
    fn header_is_well_formed() {
        let p = std::env::temp_dir().join(format!("nbx-test-{}.qcow2", std::process::id()));
        super::create(&p, 20 << 30).unwrap();
        let b = std::fs::read(&p).unwrap();
        assert_eq!(&b[0..4], b"QFI\xfb");
        assert_eq!(u64::from_be_bytes(b[24..32].try_into().unwrap()), 20 << 30);
        assert_eq!(b.len() as u64, 4 * super::CLUSTER);
        std::fs::remove_file(p).unwrap();
    }
}

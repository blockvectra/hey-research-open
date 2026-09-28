import io, os, tarfile
here = os.path.dirname(os.path.abspath(__file__))
buf = io.BytesIO()
with tarfile.open(fileobj=buf, mode="w", format=tarfile.PAX_FORMAT, pax_headers={"comment": "0123456789abcdef0123456789abcdef01234567"}) as tar:
    def add(path, arc):
        info = tar.gettarinfo(path, arcname=arc)
        info.mtime = 0; info.uid = info.gid = 0; info.uname = info.gname = ""
        with open(path, "rb") as f:
            tar.addfile(info, f)
    root = "open-dev-data-master"
    d = tarfile.TarInfo(root); d.type = tarfile.DIRTYPE; d.mode = 0o755; tar.addfile(d)
    add(os.path.join(here, "README.md"), f"{root}/README.md")
    # Reverse order on purpose: the replay sorts by the dated prefix, not by archive order.
    for name in sorted(os.listdir(os.path.join(here, "migrations")), reverse=True):
        add(os.path.join(here, "migrations", name), f"{root}/migrations/{name}")
import gzip
with open(os.path.join(here, "..", "open-dev-data-archive.tar.gz"), "wb") as out:
    out.write(gzip.compress(buf.getvalue(), mtime=0))

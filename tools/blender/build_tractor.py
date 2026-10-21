# AgriDx procedural tractor. Run: blender -b -P build_tractor.py
# Blender coords: +X forward, +Y left, +Z up. glTF export converts to Y-up.
import bpy, bmesh, math, json, os
from mathutils import Matrix, Vector
OUT = "/workspace/models/tractor_parts"
bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene

# ---------------- procedural textures (numpy, tileable, baked to images) ----------------
import numpy as np
TEX = os.path.join(OUT, "textures"); os.makedirs(TEX, exist_ok=True)
rng = np.random.default_rng(7)
def fnoise(n, beta, seed):
    r = np.random.default_rng(seed).standard_normal((n, n))
    fx = np.fft.fftfreq(n)[:, None]; fy = np.fft.fftfreq(n)[None, :]
    f = np.sqrt(fx**2 + fy**2); f[0, 0] = 1
    out = np.real(np.fft.ifft2(np.fft.fft2(r) / f**beta))   # periodic => tileable
    return (out - out.mean()) / out.std()
def save_img(name, rgb, noncolor):
    n = rgb.shape[0]
    a = np.concatenate([rgb, np.ones((n, n, 1))], 2).astype(np.float32)
    if not noncolor:   # linear -> sRGB encode for 8-bit color textures
        a[..., :3] = np.where(a[..., :3] <= 0.0031308, a[..., :3]*12.92, 1.055*np.power(a[..., :3], 1/2.4) - 0.055)
    img = bpy.data.images.new(name, n, n); img.pixels.foreach_set(a.ravel())
    img.filepath_raw = os.path.join(TEX, name + ".png"); img.file_format = 'PNG'; img.save()
    if noncolor: img.colorspace_settings.name = 'Non-Color'
    return img
N = 1024
low = fnoise(N, 1.6, 1); mid = fnoise(N, 1.1, 2); hi = fnoise(N, 0.6, 3)
wear = np.clip((hi * 0.6 + mid * 0.5 - 2.3) * 1.5, 0, 0.7)          # sparse chipped / rubbed spots
green = np.array([0.012, 0.10, 0.022])
pc = green[None, None, :] * (1 + 0.07 * low[..., None]) 
pc = pc * (1 - wear[..., None]) + np.array([0.09, 0.10, 0.08]) * wear[..., None]   # worn spots -> primer grey
IMG_paint = save_img("paint_basecolor", np.clip(pc, 0, 1) ** (1/2.2) if False else np.clip(pc, 0, 1), False)
rough = np.clip(0.26 + 0.05 * mid + 0.35 * wear, 0.05, 1)
IMG_paint_orm = save_img("paint_orm", np.stack([np.ones_like(rough), rough, 0.25 * wear], 2), True)
n2 = 512
rl = fnoise(n2, 0.9, 4); rh = fnoise(n2, 0.3, 5)
rr = np.clip(0.82 + 0.06 * rl + 0.04 * rh, 0, 1)
IMG_rub_orm = save_img("rubber_orm", np.stack([np.ones_like(rr), rr, np.zeros_like(rr)], 2), True)
IMG_rub = save_img("rubber_basecolor", np.clip(np.full((n2, n2, 3), 0.018) * (1 + 0.25 * rl[..., None]) + 0.012 * np.clip(rh[..., None], 0, 3), 0, 1), False)
ml = fnoise(n2, 1.2, 6); mh = fnoise(n2, 0.5, 7)
mr = np.clip(0.36 + 0.08 * ml + 0.05 * mh, 0, 1)
IMG_metal_orm = save_img("metal_orm", np.stack([np.ones_like(mr), mr, np.ones_like(mr)], 2), True)

def texify(m, base=None, orm=None):
    nt = m.node_tree; b = nt.nodes["Principled BSDF"]
    if base is not None:
        t = nt.nodes.new("ShaderNodeTexImage"); t.image = base
        nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
    if orm is not None:
        t = nt.nodes.new("ShaderNodeTexImage"); t.image = orm
        sp = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(t.outputs["Color"], sp.inputs["Color"])
        nt.links.new(sp.outputs["Green"], b.inputs["Roughness"])
        nt.links.new(sp.outputs["Blue"], b.inputs["Metallic"])

# ---------------- materials ----------------
def mat(name, col, metal=0.0, rough=0.5, coat=0.0, trans=0.0, emit=None, estr=0.0, ior=1.45):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*col, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    b.inputs["Coat Weight"].default_value = coat
    b.inputs["Coat Roughness"].default_value = 0.04
    b.inputs["Transmission Weight"].default_value = trans
    b.inputs["IOR"].default_value = ior
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = estr
    return m
M = dict(
    paint=mat("paint_green", (0.012, 0.10, 0.022), rough=0.3, coat=1.0),
    yellow=mat("paint_yellow", (0.9, 0.5, 0.0), rough=0.3, coat=1.0),
    rubber=mat("rubber_black", (0.018, 0.018, 0.018), rough=0.88),
    metal=mat("metal_grey", (0.42, 0.43, 0.45), metal=1.0, rough=0.38),
    dark=mat("metal_dark", (0.06, 0.065, 0.07), metal=0.6, rough=0.45),
    chrome=mat("chrome", (0.92, 0.92, 0.94), metal=1.0, rough=0.06),
    glass=mat("glass", (0.75, 0.85, 0.85), rough=0.02, trans=1.0, ior=1.5),
    plastic=mat("plastic_black", (0.03, 0.03, 0.032), rough=0.45),
    seat=mat("seat_fabric", (0.04, 0.04, 0.045), rough=0.75),
    lens=mat("headlight_lens", (0.9, 0.9, 0.85), rough=0.05, emit=(1, 0.95, 0.85), estr=3.0),
    red=mat("terminal_red", (0.6, 0.02, 0.02), rough=0.4),
    taillight=mat("tail_light", (0.5, 0.01, 0.01), rough=0.1, emit=(1, 0.05, 0.02), estr=1.5),
    decal=mat("decal_yellow", (0.95, 0.62, 0.02), rough=0.35, coat=1.0),
    decal_white=mat("decal_white", (0.85, 0.86, 0.84), rough=0.35, coat=1.0),
)
texify(M['paint'], IMG_paint, IMG_paint_orm); texify(M['yellow'], None, IMG_paint_orm)
texify(M['rubber'], IMG_rub, IMG_rub_orm); texify(M['metal'], None, IMG_metal_orm)

# ---------------- primitive helpers (geometry baked in world space) ----------------
def finish(bm, m, bevel=0.0, seg=2, angle=40):
    me = bpy.data.meshes.new("p"); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new("p", me); scn.collection.objects.link(o)
    me.materials.append(m)
    if bevel > 0:
        md = o.modifiers.new("bev", "BEVEL"); md.width = bevel; md.segments = seg
        md.limit_method = "ANGLE"; md.angle_limit = math.radians(angle)
        with bpy.context.temp_override(object=o, active_object=o):
            bpy.ops.object.modifier_apply(modifier=md.name)
    return o

def xf(bm, loc=(0,0,0), rot=(0,0,0)):
    R = (Matrix.Rotation(rot[2],4,'Z') @ Matrix.Rotation(rot[1],4,'Y') @ Matrix.Rotation(rot[0],4,'X'))
    bmesh.ops.transform(bm, matrix=Matrix.Translation(loc) @ R, verts=bm.verts)

def box(size, loc, m, bevel=0.015, rot=(0,0,0), seg=2, taper=None):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        if taper: taper(v.co)   # unit-cube coords (-0.5..0.5)
        v.co = Vector((v.co.x*size[0], v.co.y*size[1], v.co.z*size[2]))
    xf(bm, loc, rot); return finish(bm, m, bevel, seg)

def rbox(size, loc, m, bev=0.06, sub=2, rot=(0,0,0), taper=None, cuts=0):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    if cuts:
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
    for v in bm.verts:
        if taper: taper(v.co)
        v.co = Vector((v.co.x*size[0], v.co.y*size[1], v.co.z*size[2]))
    xf(bm, loc, rot); o = finish(bm, m, bev, 1, 30)
    md = o.modifiers.new("sub", "SUBSURF"); md.levels = sub; md.render_levels = sub
    with bpy.context.temp_override(object=o, active_object=o):
        bpy.ops.object.modifier_apply(modifier=md.name)
    return o

FONT_LAT = None; FONT_CJK = None
def text_mesh(body, size, loc, m, side, font_path, extrude=0.0015):
    cu = bpy.data.curves.new("t", 'FONT'); cu.body = body; cu.size = size; cu.extrude = extrude
    cu.align_x = 'CENTER'; cu.align_y = 'CENTER'
    cu.font = bpy.data.fonts.load(font_path, check_existing=True)
    to = bpy.data.objects.new("t", cu); scn.collection.objects.link(to)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(to.evaluated_get(dg)); bpy.data.objects.remove(to)
    R = Matrix.Rotation(math.pi/2, 4, 'X')
    if side > 0: R = Matrix.Rotation(math.pi, 4, 'Z') @ R
    me.transform(Matrix.Translation(loc) @ R)
    me.materials.clear(); me.materials.append(m)
    o = bpy.data.objects.new("t", me); scn.collection.objects.link(o); return o

AX = {'X': (0, math.pi/2, 0), 'Y': (math.pi/2, 0, 0), 'Z': (0, 0, 0)}
def cyl(r, depth, loc, m, axis='Z', seg=32, bevel=0.0, r2=None, rot=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=depth)
    xf(bm, loc, rot or AX[axis]); return finish(bm, m, bevel)

def cyl_between(p1, p2, r, m, seg=16, bevel=0.0):
    p1, p2 = Vector(p1), Vector(p2); d = p2 - p1
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=d.length)
    q = Vector((0,0,1)).rotation_difference(d.normalized())
    bmesh.ops.transform(bm, matrix=Matrix.Translation((p1+p2)/2) @ q.to_matrix().to_4x4(), verts=bm.verts)
    return finish(bm, m, bevel)

def lathe(profile, loc, m, seg=48, axis='Y', a0=0.0, a1=2*math.pi, closed=True, sharp=None):
    """profile: list of (radius, axial). Spins around local Y."""
    bm = bmesh.new(); rings = []
    n = seg if closed else seg + 1
    for i in range(n):
        a = a0 + (a1 - a0) * i / seg
        rings.append([bm.verts.new((r*math.cos(a), y, r*math.sin(a))) for r, y in profile])
    for i in range(seg if closed else seg):
        A, B = rings[i], rings[(i+1) % n]
        for j in range(len(profile)-1):
            try: bm.faces.new((A[j], A[j+1], B[j+1], B[j]))
            except ValueError: pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    rot = {'Y': (0,0,0), 'X': (0,0,-math.pi/2), 'Z': (math.pi/2,0,0)}[axis]
    xf(bm, loc, rot); return finish(bm, m)

def torus(R, r, loc, m, rot=(0,0,0), seg=32, rseg=10):
    prof = [(R + r*math.cos(2*math.pi*k/rseg), r*math.sin(2*math.pi*k/rseg)) for k in range(rseg+1)]
    o = lathe(prof, (0,0,0), m, seg=seg)
    o.data.transform(Matrix.Translation(loc) @ (Matrix.Rotation(rot[2],4,'Z') @ Matrix.Rotation(rot[1],4,'Y') @ Matrix.Rotation(rot[0],4,'X')))
    return o

PARTS = []; GROUPS = []
def part(name, zh, objs, explode, smooth_angle=35, child=False, pid=None):
    objs = [o for o in objs if o]
    with bpy.context.temp_override(active_object=objs[0], selected_editable_objects=objs):
        bpy.ops.object.join()
    o = objs[0]; o.name = name; o.data.name = name
    me = o.data
    # dedupe material slots
    me.shade_smooth(); me.set_sharp_from_angle(angle=math.radians(smooth_angle))
    c = sum((Vector(b) for b in [v.co for v in me.vertices]), Vector()) / len(me.vertices)
    lo = Vector([min(v.co[i] for v in me.vertices) for i in range(3)])
    hi = Vector([max(v.co[i] for v in me.vertices) for i in range(3)])
    c = (lo + hi) / 2
    me.transform(Matrix.Translation(-c)); o.location = c
    o["label_zh"] = zh
    ex = Vector(explode)
    o["explode_dir_blender"] = list(ex)          # Z-up, metres
    o["explode_dir"] = [ex.x, ex.z, -ex.y]       # three.js Y-up, metres (offset vector)
    o["part_id"] = pid or name
    if not child: PARTS.append(o)
    return o
def group(name, zh, children):
    """children: list of (child_name, child_zh_suffix, objs, explode). Parent empty keeps the part name."""
    kids = [part(cn, zh + suf, objs, ex, child=True, pid=name) for cn, suf, objs, ex in children]
    e = bpy.data.objects.new(name, None); scn.collection.objects.link(e)
    c = sum((k.location for k in kids), Vector()) / len(kids); e.location = c
    for k in kids:
        k.parent = e; k.location = k.location - c
    e["label_zh"] = zh; e["part_id"] = name; e["explode_dir"] = [0.0, 0.0, 0.0]; e["explode_dir_blender"] = [0.0, 0.0, 0.0]
    e["is_group"] = True; e["children"] = [k.name for k in kids]
    GROUPS.append((e, kids)); PARTS.append(e); return e

# ---------------- dimensions ----------------
RX, RZ, RR, RW, RY = -1.2, 0.80, 0.80, 0.52, 1.0     # rear wheel
FX, FZ, FR, FW, FY = 1.45, 0.50, 0.50, 0.33, 0.86    # front wheel

# ---------------- wheels ----------------
def wheel(name, x, y, R, W, nlugs, side):
    rim_r = R * 0.62; t = W/2
    lug_h = 0.055 if R > 0.6 else 0.035
    # tyre carcass: rounded section
    prof = []
    for k in range(13):  # outer crown + shoulders, from -t to t
        a = math.pi * k / 12 - math.pi/2
        prof.append((R - 0.012 - lug_h - 0.07*(1-math.cos(a))**2, t*0.97*math.sin(a)))
    prof = [(rim_r, -t*0.8), (rim_r + (R-rim_r)*0.5, -t*0.98)] + prof + [(rim_r + (R-rim_r)*0.5, t*0.98), (rim_r, t*0.8)]
    objs = [lathe(prof, (0,0,0), M['rubber'], seg=72)]
    # chevron lugs
    for i in range(nlugs):
        for s in (-1, 1):
            a = 2*math.pi*i/nlugs + (math.pi/nlugs if s > 0 else 0)
            L = t*0.95
            bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1)
            for v in bm.verts: v.co = Vector((v.co.x*0.075*R/0.8, v.co.y*L, v.co.z*(lug_h+0.16)))
            xf(bm, (0, s*L*0.5, 0), (0, 0, s*math.radians(35)))
            xf(bm, (0, 0, R - 0.012 - (lug_h+0.16)/2), (0,0,0))
            xf(bm, (0,0,0), (0, -a, 0))  # rotate around Y
            objs.append(finish(bm, M['rubber'], 0.012, 2))
    # rim: dished yellow wheel
    d = side
    rprof = [(rim_r+0.015, -t*0.82), (rim_r, -t*0.8), (rim_r-0.03, -t*0.75), (rim_r-0.03, t*0.75), (rim_r, t*0.8), (rim_r+0.015, t*0.82)]
    objs.append(lathe(rprof, (0,0,0), M['yellow'], seg=64))
    disc = [(rim_r-0.03, d*0.02), (rim_r*0.55, d*0.06), (rim_r*0.35, d*0.09), (0.0, d*0.10)]
    objs.append(lathe(disc + [(0.0, d*0.08), (rim_r*0.35, d*0.07), (rim_r*0.55, d*0.04), (rim_r-0.03, 0.0)], (0,0,0), M['yellow'], seg=48))
    # holes impression: dark ovals on disc
    for i in range(8):
        a = 2*math.pi*i/8
        p = Vector((math.cos(a)*rim_r*0.72, d*0.045, math.sin(a)*rim_r*0.72))
        objs.append(cyl(0.05*R/0.8, 0.012, p, M['dark'], 'Y', 16))
    for i in range(16):
        a = 2*math.pi*i/16
        objs.append(cyl(0.011, 0.02, (math.cos(a)*(rim_r-0.06), d*0.035, math.sin(a)*(rim_r-0.06)), M['metal'], 'Y', 6))
    objs.append(cyl_between((rim_r-0.05, d*0.0, 0.05), (rim_r-0.05, d*0.06, 0.05), 0.006, M['metal'], 6))
    # hub + bolts
    objs.append(lathe([(0.0, d*0.24), (0.07, d*0.23), (0.10, d*0.18), (0.13, d*0.11), (0.0, d*0.11)], (0,0,0), M['metal'], seg=32))
    for i in range(8):
        a = 2*math.pi*i/8
        objs.append(cyl(0.015, 0.04, (math.cos(a)*0.17, d*0.115, math.sin(a)*0.17), M['chrome'], 'Y', 8))
    for o in objs: o.data.transform(Matrix.Translation((x, y, 0)))
    return objs

zh_w = "轮胎"
for nm, x, y, R, W, n, z in [("wheel_rl", RX, RY, RR, RW, 22, RZ), ("wheel_rr", RX, -RY, RR, RW, 22, RZ),
                             ("wheel_fl", FX, FY, FR, FW, 18, FZ), ("wheel_fr", FX, -FY, FR, FW, 18, FZ)]:
    objs = wheel(nm, x, y, R, W, n, 1 if y > 0 else -1)
    for o in objs: o.data.transform(Matrix.Translation((0, 0, z)))
    rear = nm[-2] == 'r'
    part(nm, zh_w, objs, (0 if rear else 0.35, (1.1 if y > 0 else -1.1), 0))

# ---------------- frame / chassis ----------------
f = []
for s in (1, -1):
    f.append(box((1.95, 0.08, 0.20), (1.25, s*0.30, 0.68), M['dark'], 0.01))
f.append(box((0.10, 0.68, 0.18), (2.20, 0, 0.68), M['dark'], 0.01))
f.append(box((0.10, 0.68, 0.14), (0.40, 0, 0.70), M['dark'], 0.01))
# front weight pack
for i in range(6):
    f.append(box((0.16, 0.11, 0.42), (2.36, -0.33 + i*0.132, 0.72), M['dark'], 0.02, seg=3))
f.append(box((0.08, 0.80, 0.10), (2.46, 0, 0.95), M['paint'], 0.02))
part("frame", "机架", f, (0.4, 0, -0.9))

# ---------------- front axle ----------------
fa = [box((0.16, 1.30, 0.14), (FX, 0, FZ+0.02), M['dark'], 0.02, seg=3),
      cyl(0.11, 0.22, (FX, 0, FZ+0.12), M['dark'], 'X', 24, 0.01)]
for s in (1, -1):
    fa.append(cyl(0.10, 0.12, (FX, s*0.66, FZ), M['dark'], 'Y', 24, 0.01))
    fa.append(cyl(0.05, 0.22, (FX, s*0.62, FZ), M['metal'], 'Z', 16))
fa.append(cyl_between((FX-0.12, -0.6, FZ+0.05), (FX-0.12, 0.6, FZ+0.05), 0.022, M['metal']))  # tie rod
part("front_axle", "前桥", fa, (0.5, 0, -0.6))

# ---------------- engine ----------------
e = [box((0.92, 0.42, 0.42), (1.02, 0, 0.98), M['paint'], 0.02),               # block
     box((0.90, 0.36, 0.14), (1.02, 0, 1.26), M['paint'], 0.02),               # head
     box((0.84, 0.30, 0.09), (1.02, 0, 1.37), M['dark'], 0.03, seg=3),        # valve cover
     box((0.80, 0.34, 0.14), (1.02, 0, 0.72), M['dark'], 0.03, seg=3)]        # oil pan
for i in range(4):
    e.append(cyl(0.025, 0.08, (0.74 + i*0.19, 0, 1.44), M['metal'], 'Z', 12))    # injectors
    e.append(cyl_between((0.74 + i*0.19, 0.18, 1.22), (0.74 + i*0.19, 0.30, 1.16), 0.03, M['metal']))  # exhaust runners
e.append(box((0.84, 0.06, 0.08), (1.02, 0.32, 1.13), M['metal'], 0.02))       # exhaust manifold
e.append(lathe([(0.0,-0.07),(0.10,-0.07),(0.12,-0.03),(0.12,0.03),(0.10,0.07),(0.0,0.07)], (0.80, 0.33, 1.30), M['metal'], 32, 'Y'))  # turbo
e.append(cyl_between((0.80, 0.25, 1.36), (0.80, -0.05, 1.50), 0.045, M['plastic']))
e.append(cyl(0.10, 0.04, (1.50, 0, 1.12), M['metal'], 'X', 32, 0.005))         # crank pulley
e.append(cyl(0.07, 0.04, (1.50, 0, 1.30), M['metal'], 'X', 24, 0.005))
e.append(cyl(0.055, 0.03, (1.50, -0.16, 1.00), M['metal'], 'X', 20))
fan = [cyl(0.05, 0.08, (1.58, 0, 1.18), M['dark'], 'X', 16)]
for i in range(7):
    a = 2*math.pi*i/7
    fan.append(box((0.01, 0.07, 0.20), (1.60, math.cos(a)*0.12, 1.18 + math.sin(a)*0.12), M['plastic'], 0.005, rot=(a + math.pi/2, 0.3, 0)))
e += fan
e.append(cyl(0.05, 0.16, (1.05, -0.26, 0.86), M['metal'], 'Y', 20, 0.008))      # oil filter
e.append(cyl(0.07, 0.24, (1.25, -0.27, 1.10), M['dark'], 'X', 20, 0.01))        # alternator/starter
part("engine", "发动机", e, (0.15, 0, 0.55))

# ---------------- radiator ----------------
r = [box((0.10, 0.66, 0.66), (1.90, 0, 1.08), M['metal'], 0.01)]
for i in range(12):
    r.append(box((0.012, 0.62, 0.012), (1.955, 0, 0.79 + i*0.05), M['dark'], 0))
r.append(box((0.10, 0.62, 0.06), (1.88, 0, 1.36), M['dark'], 0.01))
r.append(cyl(0.04, 0.06, (1.88, 0.15, 1.40), M['chrome'], 'Z', 16))
part("radiator", "散热器", r, (1.0, 0, 0.35))

# ---------------- battery (under hood, in front of engine) ----------------
b = [box((0.18, 0.32, 0.20), (1.72, 0, 0.86), M['plastic'], 0.012),
     cyl(0.018, 0.04, (1.72, 0.10, 0.98), M['red'], 'Z', 12),
     cyl(0.018, 0.04, (1.72, -0.10, 0.98), M['dark'], 'Z', 12),
     box((0.20, 0.34, 0.02), (1.72, 0, 0.75), M['metal'], 0.003)]
part("battery", "蓄电池", b, (0.5, -1.0, 0.0))

# ---------------- hood ----------------
def hood_taper(v):
    t = v.x + 0.5                      # 0 rear .. 1 front
    if v.z > 0:
        v.z -= 0.16 * t**1.5           # sloped nose
        v.y *= 1.0 - 0.10 * t
        v.z += 0.04 * (1 - (2*v.y)**2) # crowned top
    v.y *= 1.0 - 0.06 * t
h = [rbox((1.74, 0.88, 0.80), (1.20, 0, 1.16), M['paint'], bev=0.10, sub=2, taper=hood_taper, cuts=3)]
# grille: surround + vertical bars + perforated mesh grid behind
GX = 2.05
h.append(rbox((0.06, 0.66, 0.50), (GX, 0, 1.08), M['plastic'], bev=0.03, sub=1))
for i in range(15):
    h.append(box((0.025, 0.012, 0.44), (GX+0.035, -0.28 + i*0.04, 1.08), M['dark'], 0.004))
for i in range(9):
    h.append(box((0.02, 0.60, 0.008), (GX+0.04, 0, 0.88 + i*0.05), M['metal'], 0.002))
h.append(box((0.035, 0.66, 0.025), (GX+0.04, 0, 1.33), M['chrome'], 0.008))
h.append(box((0.035, 0.66, 0.025), (GX+0.04, 0, 0.83), M['chrome'], 0.008))
h.append(box((0.04, 0.08, 0.50), (GX+0.045, 0, 1.08), M['paint'], 0.012))
# side vents (recessed dark panel + slats), brand stripe, text decals
LAT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
CJK = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
for s_ in (1, -1):
    yy = s_ * 0.425
    h.append(box((0.46, 0.02, 0.30), (1.66, yy*0.985, 1.08), M['plastic'], 0.01))
    for i in range(6):
        h.append(box((0.44, 0.03, 0.018), (1.66, yy*1.01, 0.96 + i*0.048), M['dark'], 0.006, rot=(s_*0.5, 0, 0)))
    h.append(box((1.40, 0.008, 0.035), (1.08, s_*0.437, 1.40 - 0.0), M['decal'], 0.003, rot=(0, 0.05, 0)))
    h.append(box((1.40, 0.008, 0.010), (1.08, s_*0.437, 1.355), M['decal'], 0.002, rot=(0, 0.05, 0)))
    h.append(text_mesh("AgriDx", 0.13, (1.02, s_*0.441, 1.22), M['decal'], s_, LAT))
    h.append(text_mesh("耕知·耘诊", 0.095, (1.02, s_*0.441, 1.07), M['decal_white'], s_, CJK))
part("engine_hood", "发动机罩", h, (0.2, 0, 1.4))

# ---------------- headlights (group: front L/R, cab work lights) ----------------
def hl_front(sg):
    y = sg*0.25
    return [rbox((0.05, 0.17, 0.065), (2.03, y, 1.37), M['chrome'], bev=0.015, sub=1),
            rbox((0.03, 0.15, 0.05), (2.055, y, 1.37), M['lens'], bev=0.012, sub=1)]
wl = []
for s_ in (1, -1):
    for k in (0.15, 0.42):
        wl.append(rbox((0.07, 0.11, 0.07), (-0.10, s_*k, 2.70), M['plastic'], bev=0.015, sub=1))
        wl.append(box((0.02, 0.09, 0.05), (-0.065, s_*k, 2.70), M['lens'], 0.008))
group("headlights", "前照灯", [("headlights_front_l", "(左前)", hl_front(1), (0.9, 0.5, 1.1)),
                               ("headlights_front_r", "(右前)", hl_front(-1), (0.9, -0.5, 1.1)),
                               ("headlights_cab", "(工作灯)", wl, (0.5, 0, 2.0))])

# ---------------- exhaust ----------------
ex = [cyl(0.045, 1.25, (0.80, 0.26, 2.00), M['dark'], 'Z', 20),
      cyl(0.075, 0.55, (0.80, 0.26, 2.00), M['chrome'], 'Z', 28, 0.01),
      cyl(0.05, 0.1, (0.80, 0.26, 2.67), M['dark'], 'Z', 20, r2=0.04, rot=(0, -0.25, 0)),
      torus(0.075, 0.012, (0.80, 0.26, 1.55), M['plastic'], seg=24, rot=(math.pi/2, 0, 0))]
part("exhaust", "排气管", ex, (1.6, -1.3, 0.3))

# ---------------- clutch (bell housing + disc pack) ----------------
cl = [lathe([(0.0,-0.18),(0.30,-0.18),(0.31,-0.16),(0.27,0.17),(0.25,0.18),(0.0,0.18)], (0.38, 0, 0.92), M['dark'], 40, 'X'),
      cyl(0.32, 0.03, (0.20, 0, 0.92), M['metal'], 'X', 40, 0.005)]
for i in range(10):
    a = 2*math.pi*i/10
    cl.append(cyl(0.015, 0.05, (0.20, math.cos(a)*0.29, 0.92 + math.sin(a)*0.29), M['chrome'], 'X', 8))
part("clutch", "离合器", cl, (0.05, 0, -0.85))

# ---------------- gearbox / transmission ----------------
g = [box((1.10, 0.62, 0.52), (-0.36, 0, 0.88), M['paint'], 0.03),
     box((0.6, 0.30, 0.10), (-0.30, 0, 1.18), M['dark'], 0.02),
     box((0.25, 0.08, 0.25), (-0.10, -0.34, 0.85), M['metal'], 0.02)]
for i in range(6):
    g.append(box((0.03, 0.64, 0.03), (-0.75 + i*0.16, 0, 0.62), M['dark'], 0.005))
part("gearbox", "变速箱", g, (0.0, 0, -1.2))

# ---------------- rear axle ----------------
ra = [lathe([(0.0,-0.30),(0.24,-0.30),(0.33,-0.15),(0.33,0.15),(0.24,0.30),(0.0,0.30)], (RX, 0, RZ), M['paint'], 40, 'Y')]
for s in (1, -1):
    ra.append(lathe([(0.0,0.0),(0.20,0.0),(0.13,0.12),(0.12,0.38),(0.15,0.42),(0.15,0.50),(0.0,0.50)] if s>0 else
                    [(0.0,0.0),(0.20,0.0),(0.13,-0.12),(0.12,-0.38),(0.15,-0.42),(0.15,-0.50),(0.0,-0.50)],
                    (RX, s*0.28, RZ), M['paint'], 32, 'Y'))
    ra.append(cyl(0.06, 0.3, (RX, s*0.83, RZ), M['metal'], 'Y', 20))
part("rear_axle", "后桥", ra, (0, 0, -0.5))

# ---------------- fuel tank (left side, under cab step) ----------------
ft = [rbox((0.72, 0.32, 0.42), (-0.25, 0.50, 0.98), M['paint'], bev=0.06, sub=2),
      cyl(0.05, 0.04, (-0.05, 0.50, 1.21), M['chrome'], 'Z', 20, 0.006),
      box((0.74, 0.04, 0.04), (-0.25, 0.67, 0.84), M['dark'], 0.008)]
part("fuel_tank", "油箱", ft, (0.0, 1.0, -0.2))

# ---------------- fenders (group L/R, rounded section following the wheel) ----------------
def fender(sg):
    # closed cross-section: outer skin rolled down at outer edge, inner skin 15mm inside
    outer = [(0.90, -0.31), (0.94, -0.30), (0.965, -0.24), (0.975, -0.10), (0.975, 0.12), (0.965, 0.26), (0.94, 0.315), (0.88, 0.33)]
    inner = [(0.875, 0.315), (0.925, 0.30), (0.95, 0.25), (0.96, 0.12), (0.96, -0.10), (0.95, -0.23), (0.925, -0.285), (0.885, -0.295)]
    prof = [(r, sg*y) for r, y in outer + inner + [outer[0]]]
    o = [lathe(prof, (RX, sg*RY, RZ), M['paint'], 40, 'Y', a0=math.radians(-8), a1=math.radians(168), closed=False)]
    o.append(rbox((0.10, 0.05, 0.07), (RX - 0.62, sg*(RY + 0.30), RZ + 0.70), M['taillight'], bev=0.015, sub=1))
    o.append(box((0.30, 0.22, 0.03), (RX + 0.55, sg*(RY - 0.18), RZ + 0.62), M['dark'], 0.006, rot=(0, 0.6, 0)))  # step/mount
    return o
group("fenders", "挡泥板", [("fender_l", "(左)", fender(1), (0, 0.8, 0.8)),
                            ("fender_r", "(右)", fender(-1), (0, -0.8, 0.8))])

# ---------------- cab ----------------
cx0, cx1, cw, cz0, cz1 = -1.72, -0.22, 0.64, 1.18, 2.58
c = [rbox((cx1-cx0, 2*cw, 0.07), ((cx0+cx1)/2, 0, cz0), M['dark'], bev=0.02, sub=1)]   # floor
P = 0.045
def post(p1, p2): c.append(cyl_between(p1, p2, P/2, M['plastic'], 12))
for s_ in (1, -1):
    y = s_*(cw-0.03)
    post((cx1-0.03, y, cz0), (cx1-0.10, y, cz1))      # A pillar (slight rake)
    post((cx0+0.03, y, cz0), (cx0+0.06, y, cz1))      # C pillar
    post((-0.82, y, cz0+0.05), (-0.84, y, cz1))      # B pillar / door hinge side
    # door frame (front door between A and B pillar)
    c.append(box((0.62, 0.025, 0.03), (-0.52, s_*(cw-0.02), cz0+0.40), M['plastic'], 0.006))
    c.append(box((0.62, 0.025, 0.03), (-0.53, s_*(cw-0.02), cz1-0.08), M['plastic'], 0.006))
    c.append(box((0.025, 0.025, 0.18), (-0.30, s_*(cw), 1.75), M['chrome'], 0.006))    # handle
    c.append(cyl_between((cx1-0.08, s_*(cw), 2.40), (cx1+0.08, s_*(cw+0.30), 2.44), 0.010, M['plastic'], 8))
    c.append(rbox((0.035, 0.15, 0.24), (cx1+0.09, s_*(cw+0.33), 2.36), M['plastic'], bev=0.015, sub=1))
def roof_taper(v):
    if v.z > 0:
        v.z += 0.35 * (0.25 - v.x*v.x) + 0.35 * (0.25 - v.y*v.y)   # domed top
        v.x *= 0.97; v.y *= 0.97
c.append(rbox((cx1-cx0+0.34, 2*cw+0.26, 0.16), ((cx0+cx1)/2+0.04, 0, cz1+0.08), M['paint'], bev=0.05, sub=2, taper=roof_taper, cuts=2))
c.append(rbox((cx1-cx0+0.10, 2*cw+0.05, 0.05), ((cx0+cx1)/2+0.02, 0, cz1-0.01), M['plastic'], bev=0.015, sub=1))
# glass (separate material) - front glass raked with A pillars
gz = (cz0+cz1)/2 + 0.02; gh = cz1-cz0-0.10
c.append(box((0.008, 2*cw-0.07, gh), (cx1-0.065, 0, gz), M['glass'], 0, rot=(0, math.atan2(0.07, cz1-cz0), 0)))
c.append(box((0.008, 2*cw-0.07, gh), (cx0+0.045, 0, gz), M['glass'], 0))
for s_ in (1, -1):
    c.append(box((cx1-cx0-0.12, 0.008, gh), ((cx0+cx1)/2, s_*(cw-0.03), gz), M['glass'], 0))
c.append(box((0.30, 0.25, 0.035), (-0.55, 0.78, 0.66), M['dark'], 0.005))
c.append(box((0.30, 0.25, 0.035), (-0.55, 0.78, 0.93), M['dark'], 0.005))
c.append(cyl_between((-0.70, 0.90, 0.66), (-0.72, 0.68, 1.95), 0.012, M['chrome'], 8))   # grab rail
c.append(rbox((0.26, 0.58, 0.40), (-0.42, 0, 1.40), M['plastic'], bev=0.03, sub=1))     # dash console
c.append(box((0.01, 0.30, 0.12), (-0.28, 0, 1.62), M['lens'], 0.004))                    # instrument glow
part("cab", "驾驶室", c, (-0.2, 0, 1.3))

# ---------------- seat ----------------
st = [rbox((0.48, 0.50, 0.11), (-1.25, 0, 1.55), M['seat'], bev=0.04, sub=2),
      rbox((0.12, 0.50, 0.58), (-1.50, 0, 1.86), M['seat'], bev=0.05, sub=2, rot=(0, -0.18, 0)),
      cyl(0.06, 0.30, (-1.25, 0, 1.35), M['metal'], 'Z', 16)]
for s in (1, -1):
    st.append(box((0.32, 0.06, 0.05), (-1.25, s*0.29, 1.68), M['seat'], 0.02))
part("seat", "座椅", st, (-0.3, 0, 0.9))

# ---------------- steering wheel ----------------
sw = [torus(0.19, 0.018, (-0.60, 0, 1.92), M['plastic'], seg=40, rot=(0, math.radians(-55), 0)),
      cyl_between((-0.42, 0, 1.58), (-0.60, 0, 1.92), 0.03, M['dark'])]
for i in range(3):
    a = 2*math.pi*i/3 + math.pi/2
    p = Vector((0, math.cos(a)*0.18, math.sin(a)*0.18))
    p.rotate(Matrix.Rotation(math.radians(-55), 3, 'Y'))
    sw.append(cyl_between((-0.60, 0, 1.92), Vector((-0.60, 0, 1.92)) + p, 0.012, M['dark'], seg=8))
part("steering_wheel", "方向盘", sw, (0.4, 0, 1.0))

# ---------------- hydraulic lift ----------------
hy = [box((0.40, 0.60, 0.22), (-1.62, 0, 1.05), M['paint'], 0.03),
      cyl(0.05, 0.70, (-1.70, 0, 1.12), M['metal'], 'Y', 20)]
for s in (1, -1):
    hy.append(box((0.62, 0.05, 0.09), (-1.98, s*0.38, 1.05), M['paint'], 0.015, rot=(0, 0.25, 0)))   # lift arm
    hy.append(cyl_between((-1.45, s*0.42, 0.72), (-1.85, s*0.40, 0.98), 0.045, M['paint'], 20))       # cylinder barrel
    hy.append(cyl_between((-1.85, s*0.40, 0.98), (-2.12, s*0.40, 1.02), 0.022, M['chrome'], 16))       # rod
    hy.append(cyl_between((-1.45, s*0.42, 0.74), (-1.60, s*0.30, 0.95), 0.01, M['plastic'], 8))        # hose
part("hydraulic_lift", "液压提升器", hy, (-0.6, 0, 0.7))

# ---------------- three point hitch ----------------
th = []
for s in (1, -1):
    th.append(cyl_between((-1.45, s*0.36, 0.52), (-2.30, s*0.46, 0.44), 0.035, M['yellow'], 16, 0))
    th.append(torus(0.045, 0.015, (-2.30, s*0.46, 0.44), M['metal'], rot=(0, 0, 0), seg=16, rseg=8))
    th.append(cyl_between((-2.22, s*0.40, 1.00), (-2.00, s*0.44, 0.50), 0.018, M['metal'], 12))   # lift rod
th.append(cyl_between((-1.82, 0, 1.22), (-2.35, 0, 1.10), 0.035, M['yellow'], 16))
th.append(cyl(0.05, 0.18, (-2.08, 0, 1.15), M['metal'], 'X', 16, rot=(0, math.pi/2 - 0.22, 0)))
th.append(torus(0.045, 0.015, (-2.35, 0, 1.10), M['metal'], seg=16, rseg=8))
part("three_point_hitch", "三点悬挂", th, (-1.0, 0, -0.1))

# ---------------- PTO ----------------
pt = [cyl(0.035, 0.35, (-1.92, 0, 0.68), M['chrome'], 'X', 12),
      cyl(0.09, 0.06, (-1.76, 0, 0.68), M['dark'], 'X', 24, 0.008),
      lathe([(0.15, 0.0), (0.16, 0.0), (0.16, 0.26), (0.15, 0.26)], (-1.74, 0, 0.68), M['paint'], 16, 'X', a0=0.0, a1=math.pi, closed=False)]
part("pto", "动力输出轴", pt, (-0.9, 0, 0.35))

# ---------------- UVs: box projection (1 tile per metre) for tileable textures ----------------
def box_uv(o):
    me = o.data
    uv = me.uv_layers.new(name="UVMap")
    W = o.matrix_world
    for poly in me.polygons:
        n = poly.normal; ax = max(range(3), key=lambda i: abs(n[i]))
        for li in poly.loop_indices:
            p = W @ me.vertices[me.loops[li].vertex_index].co
            u, v = [(p.y, p.z), (p.x, p.z), (p.x, p.y)][ax]
            uv.data[li].uv = (u * 1.0, v * 1.0)
ALL = [o for o in scn.objects if o.type == 'MESH']
bpy.context.view_layer.update()
for o in ALL: box_uv(o)

# ---------------- export ----------------
for p in PARTS: p.select_set(True)
glb = os.path.join(OUT, "tractor_parts.glb")
bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', export_extras=True, export_yup=True, export_apply=True, export_image_format='JPEG', export_jpeg_quality=85)
def tris(o):
    o.data.calc_loop_triangles(); return len(o.data.loop_triangles)
def rec(o):
    return dict(name=o.name, label_zh=o["label_zh"], part_id=o["part_id"],
                explode_dir=[round(v, 3) for v in o["explode_dir"]],
                explode_dir_blender_zup=[round(v, 3) for v in o["explode_dir_blender"]],
                origin=[round(v, 3) for v in (o.matrix_world.translation.x, o.matrix_world.translation.z, -o.matrix_world.translation.y)],
                materials=[m.name for m in o.data.materials if m], triangles=tris(o))
info = []; tot = 0
bpy.context.view_layer.update()
for p in PARTS:
    if p.type == 'EMPTY':
        kids = [rec(k) for k in p.children]
        n = sum(k["triangles"] for k in kids)
        info.append(dict(name=p.name, label_zh=p["label_zh"], part_id=p.name, is_group=True,
                         explode_dir=[0, 0, 0], triangles=n, children=kids))
    else:
        r_ = rec(p); n = r_["triangles"]; info.append(r_)
    tot += n
json.dump(dict(version=2, units="metres",
               up_axis="Y (glTF/three.js). explode_dir = offset vector in metres (multiply by factor 0..1). Groups (is_group) are empty nodes whose child meshes carry their own explode_dir and part_id = group name.",
               total_triangles=tot, parts=info), open(os.path.join(OUT, "parts.json"), "w"), ensure_ascii=False, indent=2)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "tractor_parts.blend"))
print("TOTAL_TRIS", tot)

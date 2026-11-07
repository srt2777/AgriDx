"""Generate the two-sided replacement hood lettering for the existing parts GLB.

Run with Blender: blender -b -P tools/blender/sijia_decals.py -- /tmp/sijia-decals.json
The resulting geometry is inserted into the existing, otherwise unchanged GLB by
update-tractor-brand.mjs. Local installed fonts are used only to outline the text.
"""
import bpy, json, math, os, sys
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
if len(args) != 1:
    raise SystemExit('Expected the output JSON path after --')

def first_font(paths):
    for path in paths:
        if os.path.isfile(path):
            return path
    raise FileNotFoundError('Install a CJK font and an Arial/DejaVu bold font.')

latin = first_font(['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf'])
cjk = first_font(['/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc', '/System/Library/Fonts/STHeiti Medium.ttc'])
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
translation = Vector((1.2225000262260437, 1.1684778034687042, 0))
scale = 0.8924999833106995

def outline(text, size, height, font_path):
    vertices, normals = [], []
    for side in (1, -1):
        curve = bpy.data.curves.new('brand', 'FONT')
        curve.body, curve.size, curve.extrude = text, size, 0.0015
        curve.resolution_u = 4
        curve.align_x = curve.align_y = 'CENTER'
        curve.font = bpy.data.fonts.load(font_path, check_existing=True)
        obj = bpy.data.objects.new('brand', curve)
        scene.collection.objects.link(obj)
        mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(bpy.context.evaluated_depsgraph_get()))
        bpy.data.objects.remove(obj, do_unlink=True)
        rotation = Matrix.Rotation(math.pi / 2, 4, 'X')
        if side > 0:
            rotation = Matrix.Rotation(math.pi, 4, 'Z') @ rotation
        mesh.transform(Matrix.Translation((1.02, side * 0.441, height)) @ rotation)
        mesh.calc_loop_triangles()
        for triangle in mesh.loop_triangles:
            coords = [mesh.vertices[i].co.copy() for i in triangle.vertices]
            normal = (coords[1] - coords[0]).cross(coords[2] - coords[0]).normalized()
            gltf_normal = (normal.x, normal.z, -normal.y)
            for point in coords:
                gltf = (Vector((point.x, point.z, -point.y)) - translation) / scale
                vertices.extend(gltf)
                normals.extend(gltf_normal)
        bpy.data.meshes.remove(mesh)
    return {'positions': vertices, 'normals': normals}

with open(args[0], 'w', encoding='utf-8') as out:
    json.dump({'yellow': outline('SIJIA', 0.13, 1.22, latin),
               'white': outline('司稼', 0.095, 1.07, cjk)}, out, ensure_ascii=False)
print('Replacement decal outlines written to', args[0])
